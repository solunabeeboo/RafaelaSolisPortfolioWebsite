import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PUBLISH_PATHS } from '../scripts/vault-lib.mjs';
import { makeVault, makeSite, addRemote, startServer, gitIn } from './server-helpers.mjs';

const PORT = 4342;
const PUBLISH_OPTS = { skipBuild: true, prerender: false };

/** Run `fn` against a server with a vault (own remote) and a site on `branch`. */
async function withServer({ branch, remote = true, vaultRemote = true }, fn) {
    const vaultDir = makeVault();
    const site = makeSite({ branch, remote });
    const vaultBare = vaultRemote ? addRemote(vaultDir, 'vault') : null;
    const server = await startServer({ port: PORT, vaultDir, siteDir: site.dir });
    try { await fn({ server, vaultDir, site, vaultBare }); }
    finally { await server.stop(); }
}

const refs = bare => gitIn(bare, 'for-each-ref', '--format=%(refname:short)').split(/\r?\n/).filter(Boolean);

test('refuses main without confirmLive, before writing anything', async () => {
    await withServer({ branch: 'main' }, async ({ server, site, vaultDir, vaultBare }) => {
        const headBefore = site.git('rev-parse', 'HEAD');
        const res = await server.post('/api/publish', { message: 'oops', ...PUBLISH_OPTS });
        assert.equal(res.status, 403);
        assert.equal(res.body.error, 'main-protected');
        assert.equal((await server.post('/api/publish', { confirmLive: 'yes', ...PUBLISH_OPTS })).status, 403, 'only literal true counts');
        assert.ok(!fs.existsSync(path.join(site.dir, 'src')), 'site untouched');
        assert.equal(site.git('rev-parse', 'HEAD'), headBefore);
        assert.deepEqual(refs(site.bare), [], 'nothing pushed');
        assert.deepEqual(refs(vaultBare), [], 'vault not pushed either');
        assert.equal((await server.get('/api/publish/preview')).body.willDeploy, true);
        assert.equal(gitIn(vaultDir, 'status', '--porcelain'), '');
    });
});

test('publishes to a branch: commits only publish paths, pushes the branch, says it is not live', async () => {
    await withServer({ branch: 'redesign' }, async ({ server, site, vaultDir, vaultBare }) => {
        fs.writeFileSync(path.join(site.dir, 'unrelated.txt'), 'work in progress');
        await server.post('/api/items/notes', { title: 'Unsaved thought', body: 'private' }); // vault has something new to commit
        const events = [];
        const stream = fetch(server.base + '/api/events').then(async r => {
            const dec = new TextDecoder();
            for await (const c of r.body) events.push(dec.decode(c));
        }).catch(() => {});

        const res = await server.post('/api/publish', { message: 'Test publish', ...PUBLISH_OPTS });
        assert.equal(res.status, 200, res.text);
        const out = res.body;
        assert.equal(out.ok, true, JSON.stringify(out.steps));
        assert.equal(out.deployed, false);
        assert.equal(out.branch, 'redesign');
        assert.match(out.message, /Saved to redesign\. Not live/);
        assert.deepEqual(out.steps.map(s => s.name), ['write', 'size-check', 'commit-vault', 'commit-site', 'push-vault', 'push-site']);
        assert.ok(out.steps.every(s => s.ok));

        // Vault first, then site, both with her message
        assert.equal(gitIn(vaultDir, 'log', '-1', '--format=%s'), 'Test publish');
        assert.equal(site.git('log', '-1', '--format=%s'), 'Test publish');
        const committed = site.git('show', '--name-only', '--format=', 'HEAD').split(/\r?\n/).filter(Boolean);
        assert.ok(committed.length > 10);
        for (const f of committed) assert.ok(PUBLISH_PATHS.some(p => f.startsWith(p + '/')), `${f} is outside the publish paths`);
        assert.ok(committed.some(f => f.startsWith('src/content/projects/')));
        assert.ok(!committed.includes('unrelated.txt'));
        assert.match(site.git('status', '--porcelain'), /\?\? unrelated\.txt/, 'her other work is left alone');

        // Nothing private went out
        const content = fs.readdirSync(path.join(site.dir, 'src/content/projects')).map(f => fs.readFileSync(path.join(site.dir, 'src/content/projects', f), 'utf8')).join('\n');
        assert.ok(!/visibility: private|todo:|TODO\(/.test(content));
        assert.ok(!fs.existsSync(path.join(site.dir, 'src/content/notes')) && !fs.existsSync(path.join(site.dir, 'src/content/inbox')));

        assert.deepEqual(refs(site.bare), ['redesign']);
        assert.deepEqual(refs(vaultBare), ['main']);

        await new Promise(r => setTimeout(r, 200));
        const log = events.join('');
        assert.match(log, /event: publish:step/);
        assert.match(log, /"name":"push-site","status":"ok"/);

        // Publishing again with nothing new commits nothing
        const again = await server.post('/api/publish', PUBLISH_OPTS);
        assert.equal(again.body.ok, true);
        assert.match(again.body.steps.find(s => s.name === 'commit-site').detail, /Nothing new/);
        void stream;
    });
});

test('main goes out only with confirmLive: true', async () => {
    await withServer({ branch: 'main' }, async ({ server, site }) => {
        const res = await server.post('/api/publish', { message: 'Go live', confirmLive: true, ...PUBLISH_OPTS });
        assert.equal(res.body.ok, true, JSON.stringify(res.body.steps));
        assert.equal(res.body.deployed, true);
        assert.match(res.body.message, /Pushed to main/);
        assert.deepEqual(refs(site.bare), ['main']);
    });
});

test('without a remote it commits locally and says so', async () => {
    await withServer({ branch: 'redesign', remote: false, vaultRemote: false }, async ({ server, site }) => {
        const res = await server.post('/api/publish', PUBLISH_OPTS);
        assert.equal(res.body.ok, true);
        assert.equal(res.body.deployed, false);
        assert.match(res.body.steps.find(s => s.name === 'push-site').detail, /No remote/);
        assert.match(site.git('log', '-1', '--format=%s'), /^Publish /);
    });
});

test('refuses a file over 50 MB and leaves the repos uncommitted', async () => {
    await withServer({ branch: 'redesign' }, async ({ server, site, vaultDir, vaultBare }) => {
        fs.writeFileSync(path.join(vaultDir, 'media/huge.bin'), Buffer.alloc(51 * 1024 * 1024));
        const siteHead = site.git('rev-parse', 'HEAD');
        const vaultHead = gitIn(vaultDir, 'rev-parse', 'HEAD');
        const res = await server.post('/api/publish', PUBLISH_OPTS);
        assert.equal(res.status, 200);
        assert.equal(res.body.ok, false);
        const failed = res.body.steps.find(s => !s.ok);
        assert.equal(failed.name, 'size-check');
        assert.match(failed.detail, /huge\.bin \(51 MB\)/);
        assert.equal(res.body.steps.at(-1), failed, 'stops at the failed step');
        assert.match(res.body.message, /Stopped at "size-check"/);
        assert.equal(site.git('rev-parse', 'HEAD'), siteHead);
        assert.equal(gitIn(vaultDir, 'rev-parse', 'HEAD'), vaultHead);
        assert.deepEqual(refs(vaultBare), []);
    });
});

test('a failing build stops before anything is committed', async () => {
    await withServer({ branch: 'redesign' }, async ({ server, site }) => {
        // The temp site has no astro install, so the build step cannot succeed
        const head = site.git('rev-parse', 'HEAD');
        const res = await server.post('/api/publish', { prerender: false });
        assert.equal(res.body.ok, false);
        assert.equal(res.body.steps.find(s => !s.ok).name, 'build');
        assert.equal(site.git('rev-parse', 'HEAD'), head);
    });
});

test('only one publish runs at a time', async () => {
    await withServer({ branch: 'redesign' }, async ({ server }) => {
        const [a, b] = await Promise.all([server.post('/api/publish', PUBLISH_OPTS), server.post('/api/publish', PUBLISH_OPTS)]);
        assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    });
});

// ── Regressions from the v2 end-to-end review ─────────────────────────────

test('a big file that a checkpoint already committed still stops the publish', async () => {
    await withServer({ branch: 'redesign' }, async ({ server, site, vaultDir }) => {
        fs.writeFileSync(path.join(vaultDir, 'media/huge.bin'), Buffer.alloc(51 * 1024 * 1024));
        gitIn(vaultDir, 'add', '-A');
        gitIn(vaultDir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'Checkpoint');
        assert.equal(gitIn(vaultDir, 'status', '--porcelain'), '', 'nothing is "changed" any more');
        const res = await server.post('/api/publish', PUBLISH_OPTS);
        assert.equal(res.body.ok, false);
        assert.match(res.body.steps.find(s => !s.ok).detail, /huge\.bin \(51 MB\)/);
        void site;
    });
});

test('publish stages the deletion of the pre-vault public/projects folder', async () => {
    const vaultDir = makeVault();
    const site = makeSite({ branch: 'redesign', remote: true });
    fs.mkdirSync(path.join(site.dir, 'public/projects/images'), { recursive: true });
    fs.writeFileSync(path.join(site.dir, 'public/projects/images/old.webp'), 'old');
    site.git('add', '-A');
    site.git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'Legacy files');
    const server = await startServer({ port: 4345, vaultDir, siteDir: site.dir });
    try {
        const res = await server.post('/api/publish', PUBLISH_OPTS);
        assert.equal(res.body.ok, true, JSON.stringify(res.body.steps));
        assert.ok(!fs.existsSync(path.join(site.dir, 'public/projects')));
        assert.equal(site.git('ls-files', 'public/projects'), '', 'deletion committed, not left dirty');
        assert.equal(site.git('status', '--porcelain', '--', 'public/projects'), '');
    } finally { await server.stop(); }
});

test('a site branch switched to main mid-publish is not pushed', async () => {
    const { runPublish } = await import('../scripts/vault-server/publish.mjs');
    const calls = [];
    let branch = 'redesign';
    const git = (name, extra = {}) => ({
        cwd: '.', isRepo: () => true, hasRemote: async () => true,
        branch: async () => branch,
        changedFiles: async () => [], bigInHead: async () => [],
        commit: async () => { calls.push(`${name}:commit`); return 'abc'; },
        push: async b => { calls.push(`${name}:push:${b}`); },
        ...extra,
    });
    const app = {
        publishing: false, siteRoot: '.', hub: { send() {} }, deploy: { invalidate() {} },
        vaultGit: git('vault'), siteGit: git('site'),
        vault: { publish: async () => { branch = 'main'; return { counts: {}, written: [], removed: [], skipped: [], warnings: [], failed: [] }; } },
    };
    const out = await runPublish(app, { skipBuild: true, prerender: false });
    assert.equal(out.ok, false);
    assert.match(out.message, /branch changed from redesign to main/);
    assert.ok(!calls.some(c => c.startsWith('site:')), calls.join(','));
});

test('jobs keep their own id and report when work is queued or running', async () => {
    const { createJobs } = await import('../scripts/vault-server/jobs.mjs');
    const jobs = createJobs({ send() {} });
    let release;
    const id = jobs.enqueue(() => new Promise(r => { release = r; }), { kind: 'upload', type: 'projects', id: 'the-owl-keeper' });
    assert.notEqual(id, 'the-owl-keeper');
    assert.equal(jobs.get(id).id, id);
    assert.equal(jobs.get(id).itemId, 'the-owl-keeper');
    assert.equal(jobs.busy(), true);
    await new Promise(r => setTimeout(r, 20));
    release();
    await new Promise(r => setTimeout(r, 20));
    assert.equal(jobs.get(id).status, 'done');
    assert.equal(jobs.busy(), false);
});
