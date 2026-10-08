import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpDir } from './data-helpers.mjs';
import { makeVault, REPO, makeSite, startServer, rawRequest, waitForEvent, gitIn } from './server-helpers.mjs';

const PORT = 4343;
const IDLE_PORT = 4344;

test('token, host and origin checks', async () => {
    const server = await startServer({ port: PORT, vaultDir: makeVault(), siteDir: makeSite().dir, flags: ['--no-astro', '--checkpoint-ms', '400'] });
    try {
        const token = fs.readFileSync(path.join(server.state, 'token'), 'utf8');
        assert.match(token, /^[0-9a-f]{48}$/);
        const host = `127.0.0.1:${PORT}`;
        const req = (o = {}) => rawRequest({ port: PORT, headers: { host, ...o.headers }, ...o });

        // Ping is open; everything else needs the cookie
        assert.equal((await req({ path: '/api/ping' })).status, 200);
        assert.equal((await req({ path: '/api/state' })).status, 401);
        assert.equal((await req({ path: '/' })).status, 401);
        assert.equal((await req({ path: '/vault-media/projects/x.webp' })).status, 401);
        assert.equal((await req({ path: '/api/events' })).status, 401);
        assert.equal((await req({ path: '/?t=wrong' })).status, 401);

        // Launch link trades the token for an HttpOnly, SameSite=Strict cookie and removes it from the URL
        const launch = await req({ path: `/capture?t=${token}` });
        assert.equal(launch.status, 302);
        assert.equal(launch.headers.location, '/capture');
        const cookie = launch.headers['set-cookie'][0];
        assert.match(cookie, /HttpOnly/);
        assert.match(cookie, /SameSite=Strict/);
        const cookieHeader = cookie.split(';')[0];

        const authed = (p, extra = {}) => req({ path: p, headers: { host, cookie: cookieHeader, ...extra } });
        assert.equal((await authed('/api/state')).status, 200);
        assert.equal((await authed('/')).status, 200);
        assert.equal((await req({ path: '/api/state', headers: { host, 'x-vault-token': token } })).status, 200, 'launcher header');
        assert.equal((await req({ path: '/api/state', headers: { host, cookie: 'vault_t=' + 'a'.repeat(48) } })).status, 401);

        // Host header must be this app (DNS rebinding)
        for (const bad of ['evil.example', `evil.example:${PORT}`, '127.0.0.1:1', `127.0.0.1.evil.example:${PORT}`]) {
            const r = await req({ path: '/api/ping', headers: { host: bad } });
            assert.equal(r.status, 403, `Host ${bad}`);
        }
        assert.equal((await rawRequest({ port: PORT, path: '/api/ping', headers: { host: `localhost:${PORT}` } })).status, 200);

        // Origin must match exactly on writes
        const write = origin => req({
            method: 'POST', path: '/api/checkpoint', body: '{}',
            headers: { host, cookie: cookieHeader, 'content-type': 'application/json', ...(origin ? { origin } : {}) },
        });
        for (const bad of ['http://evil.example', 'http://127.0.0.1:9999', `http://127.0.0.1.evil.example:${PORT}`, 'null', `https://127.0.0.1:${PORT}`]) {
            assert.equal((await write(bad)).status, 403, `Origin ${bad}`);
        }
        assert.equal((await write(`http://127.0.0.1:${PORT}`)).status, 200);
        assert.equal((await write(`http://localhost:${PORT}`)).status, 200);

        const headers = (await authed('/')).headers;
        assert.equal(headers['x-content-type-options'], 'nosniff');
        assert.match(headers['content-security-policy'], /default-src 'self'/);
        assert.match(headers['content-security-policy'], /frame-ancestors 'none'/);

    } finally { await server.stop(); }
});

test('commits a checkpoint a short while after the last change', async () => {
    const vaultDir = makeVault();
    const server = await startServer({ port: PORT, vaultDir, siteDir: makeSite().dir, flags: ['--no-astro', '--no-token', '--checkpoint-ms', '500'] });
    try {
        const heard = waitForEvent(server.base, 'checkpoint');
        await new Promise(r => setTimeout(r, 300));
        const before = gitIn(vaultDir, 'rev-parse', 'HEAD');
        const file = path.join(vaultDir, 'projects');
        const first = fs.readdirSync(file).find(f => f.endsWith('.md'));
        fs.appendFileSync(path.join(file, first), '\nedited\n');
        const { hash } = await heard;
        assert.ok(hash);
        assert.notEqual(gitIn(vaultDir, 'rev-parse', 'HEAD'), before);
        assert.match(gitIn(vaultDir, 'log', '-1', '--format=%s'), /^Checkpoint \d{4}-\d\d-\d\dT/);
        assert.equal(gitIn(vaultDir, 'status', '--porcelain'), '');
    } finally { await server.stop(); }
});

test('shuts down after the idle time, checkpointing first, and waits while a window is open', async () => {
    const vaultDir = makeVault();
    const server = await startServer({ port: IDLE_PORT, vaultDir, siteDir: makeSite().dir, flags: ['--no-astro', '--no-token', '--idle-ms', '1500', '--checkpoint-ms', '600000'] });
    const stateFile = path.join(server.state, 'server.json');
    assert.ok(fs.existsSync(stateFile));

    // A connected window keeps it alive past the idle time
    const ac = new AbortController();
    const res = await fetch(server.base + '/api/events', { signal: ac.signal });
    res.body.getReader().read().catch(() => {});
    await new Promise(r => setTimeout(r, 2500));
    assert.equal(server.exitCode, null, 'still running with a window open');

    // Unsaved work is committed on the way out
    const dir = path.join(vaultDir, 'projects');
    fs.appendFileSync(path.join(dir, fs.readdirSync(dir).find(f => f.endsWith('.md'))), '\nunsaved\n');
    ac.abort();
    const until = Date.now() + 15_000;
    while (server.exitCode === null && Date.now() < until) await new Promise(r => setTimeout(r, 100));
    assert.equal(server.exitCode, 0);
    assert.ok(!fs.existsSync(stateFile), 'server.json removed');
    assert.match(gitIn(vaultDir, 'log', '-1', '--format=%s'), /^Checkpoint /);
    assert.equal(gitIn(vaultDir, 'status', '--porcelain'), '');
});

test('a second server on the same port exits with a clear message', async () => {
    const server = await startServer({ port: PORT, vaultDir: makeVault(), siteDir: makeSite().dir });
    try {
        const second = spawnSync(process.execPath, [path.join(REPO, 'scripts/vault-server.mjs'), '--port', String(PORT), '--no-astro', '--site', makeSite().dir, '--state', tmpDir('state2')], {
            env: { ...process.env, VAULT_DIR: makeVault() }, encoding: 'utf8', timeout: 20_000, windowsHide: true,
        });
        assert.equal(second.status, 1);
        assert.match(second.stderr, /already in use/);
    } finally { await server.stop(); }
});
