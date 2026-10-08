import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { tmpDir, hasFfmpeg, writeVideo } from './data-helpers.mjs';
import { makeVault, makeSite, startServer, rawRequest, waitForEvent, pollJob, gitIn } from './server-helpers.mjs';

const PORT = 4340;
let vaultDir, server;

before(async () => {
    vaultDir = makeVault();
    server = await startServer({ port: PORT, vaultDir, siteDir: makeSite().dir });
});
after(async () => { await server?.stop(); });

const upload = (name, buffer, { type = 'projects', id = 'upload-test' } = {}) =>
    fetch(`${server.base}/api/upload`, {
        method: 'POST', body: buffer,
        headers: { 'x-type': type, 'x-id': id, 'x-filename': encodeURIComponent(name), 'content-type': 'application/octet-stream' },
    });

test('ping needs no auth and state has the contract shape', async () => {
    const ping = await server.get('/api/ping');
    assert.equal(ping.status, 200);
    assert.equal(ping.body.ok, true);
    assert.ok(ping.body.version);

    const { status, body } = await server.get('/api/state');
    assert.equal(status, 200);
    for (const t of ['projects', 'experience', 'awards', 'notes', 'inbox', 'courses', 'skills']) {
        assert.ok(Array.isArray(body.collections[t]), `collections.${t}`);
    }
    assert.ok(body.collections.projects.length > 5);
    const item = body.collections.projects[0];
    for (const k of ['type', 'id', 'data', 'body', 'mtime', 'readiness']) assert.ok(k in item, `item.${k}`);
    assert.ok(Array.isArray(item.readiness.errors) && Array.isArray(item.readiness.warnings));
    assert.deepEqual(Object.keys(body.git).sort(), ['site', 'vault']);
    assert.equal(body.git.vault.branch, 'main');
    assert.deepEqual(body.live, { branch: 'main', deploysFrom: 'main' });
    assert.ok(Array.isArray(body.broken) && 'site' in body && Array.isArray(body.resumes));
});

test('a broken file is reported without hiding the others', async () => {
    fs.writeFileSync(path.join(vaultDir, 'projects/broken-one.md'), '---\ntitle: [unclosed\n---\nbody');
    const { body } = await server.get('/api/state');
    assert.ok(body.broken.some(b => b.file === 'projects/broken-one.md'));
    assert.ok(body.collections.projects.length > 5);
    fs.rmSync(path.join(vaultDir, 'projects/broken-one.md'));
});

test('create, update, and stale detection', async () => {
    const created = await server.post('/api/items/projects', { title: 'Server Test Game' });
    assert.equal(created.status, 201);
    const item = created.body.item;
    assert.equal(item.id, 'server-test-game');
    assert.equal(item.data.visibility, 'private');

    const again = await server.post('/api/items/projects', { title: 'Server Test Game' });
    assert.equal(again.body.item.id, 'server-test-game-2');

    const body = 'First.\n\n<!-- my private note -->\n\nTrailing spaces:  \nLast line without newline';
    const saved = await server.put(`/api/items/projects/${item.id}`, {
        data: { ...item.data, hook: 'A hook.' }, body, baseMtime: item.mtime,
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.item.data.hook, 'A hook.');
    assert.equal(saved.body.item.body, body, 'body is stored exactly as written');
    assert.notEqual(saved.body.item.mtime, item.mtime);

    const stale = await server.put(`/api/items/projects/${item.id}`, {
        data: { ...item.data, hook: 'Overwrite' }, body: 'x', baseMtime: item.mtime,
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error, 'stale');
    assert.equal(stale.body.item.data.hook, 'A hook.');

    const missing = await server.put('/api/items/projects/no-such-item', { data: { title: 'x' }, body: '' });
    assert.equal(missing.status, 404);
    const badType = await server.get('/api/items/widgets');
    assert.equal(badType.status, 404);
    const badId = await server.put('/api/items/projects/..%2Fevil', { data: { title: 'x' }, body: '' });
    assert.ok([400, 404].includes(badId.status));
    assert.ok(!fs.existsSync(path.join(vaultDir, 'evil.md')));
});

test('rename, delete to trash, and restore', async () => {
    const { item } = (await server.post('/api/items/projects', { title: 'Rename Me' })).body;
    const renamed = await server.post(`/api/items/projects/${item.id}/rename`, { newId: 'renamed-thing' });
    assert.equal(renamed.body.item.id, 'renamed-thing');
    assert.ok(!fs.existsSync(path.join(vaultDir, 'projects/rename-me.md')));

    const dup = await server.post('/api/items/projects/renamed-thing/rename', { newId: 'server-test-game' });
    assert.equal(dup.status, 409);

    const removed = await server.del('/api/items/projects/renamed-thing');
    assert.equal(removed.status, 200);
    const { trashId } = removed.body;
    assert.ok(trashId);
    assert.ok(!fs.existsSync(path.join(vaultDir, 'projects/renamed-thing.md')));

    const trash = await server.get('/api/trash');
    assert.ok(trash.body.some(t => t.trashId === trashId));

    const restored = await server.post(`/api/trash/${trashId}/restore`);
    assert.equal(restored.status, 200);
    assert.equal(restored.body.item.id, 'renamed-thing');
    assert.ok(fs.existsSync(path.join(vaultDir, 'projects/renamed-thing.md')));

    assert.equal((await server.del('/api/items/projects/never-existed')).status, 404);
});

test('course entries delete and restore through the same endpoints', async () => {
    const { item } = (await server.post('/api/items/courses', { title: 'Temp Course' })).body;
    const { trashId } = (await server.del(`/api/items/courses/${item.id}`)).body;
    const restored = await server.post(`/api/trash/${trashId}/restore`);
    assert.equal(restored.body.item.data.name, 'Temp Course');
});

test('reorder writes dense 1..n', async () => {
    const ids = ['server-test-game', 'server-test-game-2', 'renamed-thing'];
    assert.equal((await server.post('/api/reorder/projects', { ids })).status, 200);
    const { body } = await server.get('/api/state');
    const order = id => body.collections.projects.find(p => p.id === id).data.order;
    assert.deepEqual(ids.map(order), [1, 2, 3]);
    assert.equal((await server.post('/api/reorder/projects', { ids: 'nope' })).status, 400);
});

test('site and resumes', async () => {
    const site = (await server.get('/api/state')).body.site;
    const next = { ...site, home: { ...site.home, tagline: 'Changed by test' } };
    const put = await server.put('/api/site', { site: next });
    assert.equal(put.status, 200);
    assert.equal(JSON.parse(fs.readFileSync(path.join(vaultDir, 'site.json'), 'utf8')).home.tagline, 'Changed by test');

    const resumes = (await server.get('/api/state')).body.resumes;
    assert.equal((await server.put('/api/resumes', { resumes })).status, 200);
    const bad = await server.put('/api/resumes', { resumes: [{ id: 'x' }] });
    assert.equal(bad.status, 400);
});

test('inbox capture can be filed as a project', async () => {
    const created = await server.post('/api/items/inbox', { title: 'Cool idea', body: 'Something I built', data: { url: 'https://example.com/x' } });
    assert.equal(created.status, 201);
    const filed = await server.post('/api/items/inbox/cool-idea/file', { toType: 'projects' });
    assert.equal(filed.status, 200);
    assert.equal(filed.body.item.type, 'projects');
    assert.equal(filed.body.item.data.visibility, 'private');
    assert.equal(filed.body.item.body, 'Something I built');
    assert.deepEqual(filed.body.item.data.links, [{ label: 'Link', url: 'https://example.com/x' }]);
    const inbox = (await server.get('/api/state')).body.collections.inbox;
    assert.ok(!inbox.some(i => i.id === 'cool-idea'));
    assert.equal((await server.post('/api/items/inbox/nothing/file', { toType: 'courses' })).status, 400);
});

test('image upload streams to disk, converts, and is served back', async () => {
    const png = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#a33' } }).png().toBuffer();
    const res = await upload('My Screenshot (1).PNG', png);
    assert.equal(res.status, 200);
    const { jobId } = await res.json();
    assert.ok(jobId);

    const job = await pollJob(server, jobId);
    assert.equal(job.status, 'done', job.error);
    const r = job.result;
    assert.equal(r.src, '/vault-media/projects/upload-test/my-screenshot-1.webp');
    assert.equal(r.width, 2400, 'long side capped');
    assert.ok(r.bytes > 0);
    assert.ok(fs.existsSync(path.join(vaultDir, 'media/projects/upload-test/my-screenshot-1.webp')));
    assert.deepEqual(fs.readdirSync(path.join(server.state, 'uploads')), [], 'temp upload removed');

    const served = await fetch(server.base + r.src);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get('content-type'), 'image/webp');
    assert.equal((await served.arrayBuffer()).byteLength, r.bytes);

    // Same name again gets a new file instead of overwriting
    const second = await pollJob(server, (await (await upload('My Screenshot (1).PNG', png)).json()).jobId);
    assert.equal(second.result.src, '/vault-media/projects/upload-test/my-screenshot-1-2.webp');

    const unused = (await server.get('/api/media?unused=1')).body;
    const found = unused.find(f => f.src === r.src);
    assert.ok(found && found.usedBy.length === 0 && found.bytes === r.bytes);

    // Attach it to a project and it is no longer unused
    const { item } = (await server.get('/api/items/projects/server-test-game')).body;
    await server.put('/api/items/projects/server-test-game', { data: { ...item.data, media: [r.src] }, body: item.body, baseMtime: item.mtime });
    const all = (await server.get('/api/media')).body;
    assert.deepEqual(all.find(f => f.src === r.src).usedBy, [{ type: 'projects', id: 'server-test-game' }]);
    assert.equal((await server.del('/api/media', { src: r.src })).status, 409);
    const del = await server.del('/api/media', { src: second.result.src });
    assert.equal(del.status, 200);
    assert.ok(!fs.existsSync(path.join(vaultDir, 'media/projects/upload-test/my-screenshot-1-2.webp')));
});

test('upload progress and completion arrive over SSE', async () => {
    const png = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#38a' } }).png().toBuffer();
    const done = waitForEvent(server.base, 'job:done');
    await new Promise(r => setTimeout(r, 300));
    const { jobId } = await (await upload('sse.png', png, { id: 'sse-test' })).json();
    const event = await done;
    assert.equal(event.jobId, jobId);
    assert.match(event.result.src, /sse\.webp$/);
});

test('bad uploads are refused before any processing', async () => {
    assert.equal((await upload('notes.txt', Buffer.from('hello'))).status, 415);
    const noId = await fetch(`${server.base}/api/upload`, { method: 'POST', body: 'x', headers: { 'x-type': 'projects', 'x-id': '../x', 'x-filename': 'a.png' } });
    assert.equal(noId.status, 400);
    const corrupt = await upload('corrupt.png', Buffer.from('not an image'));
    const job = await pollJob(server, (await corrupt.json()).jobId);
    assert.equal(job.status, 'error');
    assert.ok(job.error);
});

test('video upload makes a poster and the file supports Range', { skip: !hasFfmpeg() && 'ffmpeg not installed' }, async () => {
    const raw = path.join(tmpDir('vid'), 'clip.mp4');
    writeVideo(raw);
    const { jobId } = await (await upload('clip.mp4', fs.readFileSync(raw), { id: 'video-test' })).json();
    const job = await pollJob(server, jobId, 180_000);
    assert.equal(job.status, 'done', job.error);
    const r = job.result;
    assert.equal(r.kind, 'video');
    assert.equal(r.src, '/vault-media/projects/video-test/clip.mp4');
    assert.equal(r.poster, '/vault-media/projects/video-test/clip.poster.webp');
    assert.ok(r.duration > 1 && r.duration < 2);
    assert.ok(fs.existsSync(path.join(vaultDir, 'media/_originals/projects/video-test/clip.mp4')), 'original kept');

    const part = await fetch(server.base + r.src, { headers: { range: 'bytes=0-99' } });
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range').startsWith('bytes 0-99/'), true);
    assert.equal((await part.arrayBuffer()).byteLength, 100);
    const tail = await fetch(server.base + r.src, { headers: { range: 'bytes=-50' } });
    assert.equal(tail.status, 206);
    assert.equal((await tail.arrayBuffer()).byteLength, 50);
    const beyond = await fetch(server.base + r.src, { headers: { range: `bytes=${r.bytes + 10}-` } });
    assert.equal(beyond.status, 416);

    // The poster belongs to the video, so it is not an "unused" file while the video is used
    const { item } = (await server.get('/api/items/projects/server-test-game')).body;
    await server.put('/api/items/projects/server-test-game', { data: { ...item.data, media: [r.src] }, body: item.body });
    const unused = (await server.get('/api/media?unused=1')).body;
    assert.ok(!unused.some(f => f.src === r.poster));
});

test('media serving cannot escape the media folder', async () => {
    const attempts = ['/vault-media/%2e%2e/site.json', '/vault-media/..%2fsite.json', '/vault-media/%2e%2e%2f%2e%2e%2fpackage.json',
        '/vault-media/projects/..%5c..%5csite.json', '/vault-media/%00'];
    for (const p of attempts) {
        const r = await rawRequest({ port: PORT, path: p, headers: { host: `127.0.0.1:${PORT}` } });
        assert.ok([400, 403, 404].includes(r.status), `${p} -> ${r.status}`);
        assert.ok(!r.text.includes('"home"'), `${p} leaked site.json`);
    }
    assert.equal((await fetch(server.base + '/vault-media/projects/upload-test/nope.webp')).status, 404);
});

test('history lists checkpoints, shows old versions, and restores them', async () => {
    const id = 'history-thing';
    const created = (await server.post('/api/items/projects', { title: 'History Thing', body: 'version one' })).body.item;
    const cp1 = await server.post('/api/checkpoint');
    assert.ok(cp1.body.hash);
    await server.put(`/api/items/projects/${id}`, { data: { ...created.data, hook: 'second hook' }, body: 'version two' });
    const cp2 = await server.post('/api/checkpoint');
    assert.ok(cp2.body.hash && cp2.body.hash !== cp1.body.hash);
    assert.equal((await server.post('/api/checkpoint')).body.hash, null, 'nothing changed, nothing committed');

    const history = (await server.get(`/api/history/projects/${id}`)).body;
    assert.equal(history.length, 2);
    for (const k of ['hash', 'date', 'message']) assert.ok(history[0][k]);
    assert.match(history[0].message, /^Checkpoint /);

    const old = history[1];
    const view = await server.get(`/api/history/projects/${id}/${old.hash}`);
    assert.equal(view.body.body, 'version one');
    assert.equal(view.body.data.hook, '');

    const restored = await server.post(`/api/history/projects/${id}/${old.hash}/restore`);
    assert.equal(restored.status, 200);
    assert.equal(restored.body.item.body, 'version one');
    assert.equal((await server.get(`/api/history/projects/${id}/nothex!`)).status, 400);

    // json collections only list commits that changed that entry
    const course = (await server.post('/api/items/courses', { title: 'History Course' })).body.item;
    await server.post('/api/checkpoint');
    await server.put(`/api/items/courses/${course.id}`, { data: { ...course.data, term: 'Fall' } });
    await server.post('/api/checkpoint');
    await server.post('/api/items/courses', { title: 'Someone Else' });
    await server.post('/api/checkpoint');
    const courseHistory = (await server.get(`/api/history/courses/${course.id}`)).body;
    assert.equal(courseHistory.length, 2);
    assert.equal(gitIn(vaultDir, 'status', '--porcelain'), '');
});

test('edits made outside the app are announced over SSE', async () => {
    await new Promise(r => setTimeout(r, 1400)); // let the app's own-write echo suppression lapse
    const heard = waitForEvent(server.base, 'fs:changed', e => e.type === 'projects' && e.id === 'history-thing');
    await new Promise(r => setTimeout(r, 300));
    const file = path.join(vaultDir, 'projects/history-thing.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8') + '\nedited elsewhere\n');
    assert.deepEqual(await heard, { type: 'projects', id: 'history-thing' });
});

test('checkpoint event is broadcast', async () => {
    const heard = waitForEvent(server.base, 'checkpoint');
    await new Promise(r => setTimeout(r, 300));
    fs.appendFileSync(path.join(vaultDir, 'projects/history-thing.md'), 'more\n');
    await server.post('/api/checkpoint');
    assert.ok((await heard).hash);
});

test('publish preview, deploy status, and go-live are honest', async () => {
    const preview = (await server.get('/api/publish/preview')).body;
    assert.ok(Array.isArray(preview.changes) && preview.changes.length > 0);
    assert.ok(Array.isArray(preview.skipped) && Array.isArray(preview.warnings));
    assert.equal(preview.branch, 'redesign');
    assert.equal(preview.willDeploy, false);
    for (const c of preview.changes) assert.ok(['added', 'updated', 'removed'].includes(c.change));
    for (const s of preview.skipped) assert.ok(s.errors.length);

    const deploy = await server.get('/api/deploy');
    assert.equal(deploy.status, 200);
    assert.equal(typeof deploy.body.available, 'boolean');

    const live = await server.post('/api/golive', { confirmLive: true });
    assert.equal(live.status, 501);
    assert.equal(live.body.error, 'not-implemented');
});

test('unknown routes and wrong methods', async () => {
    assert.equal((await server.get('/api/nope')).status, 404);
    assert.equal((await server.post('/api/state')).status, 405);
    const bad = await fetch(server.base + '/api/items/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, 'bad-json');
});

test('UI routes serve the app shell, including /capture', async () => {
    for (const p of ['/', '/capture', '/projects/some-id']) {
        const r = await server.get(p);
        assert.equal(r.status, 200, p);
        assert.match(r.text, /<!doctype html>/i);
    }
    const bundle = await server.get('/app.js');
    assert.equal(bundle.status, 200);
    assert.match(bundle.text, /Vault fixture/, 'esbuild bundled main.jsx with preact');
    assert.equal((await server.get('/missing.js')).status, 404);
});
