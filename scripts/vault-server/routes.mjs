/** The REST API (see SPEC 3.2). Handlers return a JSON-able value, or send the response themselves. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { ITEM_TYPES, MD_TYPES, parseMd, slugify } from '../vault-lib.mjs';
import { ingest } from '../media.mjs';
import { vaultMediaSrc } from '../../src/lib/media.mjs';
import { HttpError, createRouter, readJson } from './http.mjs';
import { isHash } from './git.mjs';
import { previewFor, runPublish } from './publish.mjs';
import { resolveInside, serveFile } from './files.mjs';

const MAX_UPLOAD_BYTES = 4 * 1024 ** 3;
const UPLOAD_EXT_RE = /\.(png|jpe?g|webp|bmp|tiff?|avif|heic|gif|mp4|mov|m4v|webm|mkv|avi)$/i;
const ID_RE = /^[a-z0-9][a-z0-9-]*$/i;

const checkType = type => {
    if (!ITEM_TYPES.includes(type)) throw new HttpError(404, 'not-found', `Unknown collection "${type}"`);
    return type;
};
const object = (v, what) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'invalid', `${what} must be an object`);
    return v;
};

export function createRoutes(app) {
    const { vault } = app;
    const router = createRouter();
    const get = (p, h) => router.add('GET', p, h);
    const post = (p, h) => router.add('POST', p, h);
    const put = (p, h) => router.add('PUT', p, h);
    const del = (p, h) => router.add('DELETE', p, h);

    // ── Status ──
    get('/api/state', async () => {
        const all = vault.loadAll();
        let pending = null;
        try { pending = vault.previewPublish().changes.length; } catch { /* shown by the publish panel instead */ }
        return {
            collections: all.collections, site: all.site, resumes: all.resumes, broken: all.broken,
            git: await vault.gitStatus(),
            live: { branch: 'main', deploysFrom: 'main' },
            siteReadiness: all.siteReadiness, pending, preview: app.astro?.state ?? { running: false, url: null },
        };
    });

    get('/api/events', ({ req, res }) => { app.hub.connect(req, res); });

    // ── Items ──
    get('/api/items/:type', ({ params }) => vault.listItems(checkType(params.type)));
    get('/api/items/:type/:id', ({ params }) => ({ item: vault.getItem(checkType(params.type), params.id) }));

    put('/api/items/:type/:id', async ({ req, params }) => {
        const { type, id } = params;
        checkType(type);
        const { data, body = '', baseMtime } = await readJson(req);
        object(data, 'data');
        if (typeof body !== 'string') throw new HttpError(400, 'invalid', 'body must be text');
        vault.getItem(type, id); // 404 rather than quietly creating a stray file
        app.own(type, id);
        return { item: vault.saveItem(type, id, data, body, { baseMtime: baseMtime ?? undefined }) };
    });

    post('/api/items/:type', async ({ req, params, res }) => {
        const { type } = params;
        checkType(type);
        const { title, data, body } = await readJson(req);
        if (typeof title !== 'string') throw new HttpError(400, 'invalid', 'title is required');
        if (data !== undefined) object(data, 'data');
        const item = vault.createItem(type, { title, data, body });
        app.own(type, item.id);
        app.json(res, 201, { item });
    });

    post('/api/items/:type/:id/rename', async ({ req, params }) => {
        const { newId } = await readJson(req);
        if (typeof newId !== 'string') throw new HttpError(400, 'invalid', 'newId is required');
        app.own(params.type, params.id);
        const item = vault.renameItem(checkType(params.type), params.id, newId);
        app.own(params.type, item.id);
        return { item };
    });

    del('/api/items/:type/:id', ({ params }) => {
        app.own(checkType(params.type), params.id);
        return { trashId: vault.deleteItem(params.type, params.id) };
    });

    post('/api/items/:type/:id/file', async ({ req, params }) => {
        if (params.type !== 'inbox') throw new HttpError(400, 'invalid', 'Only inbox items can be filed');
        const { toType } = await readJson(req);
        app.own('inbox', params.id);
        const item = vault.fileInbox(params.id, toType);
        app.own(item.type, item.id);
        return { item };
    });

    post('/api/reorder/:type', async ({ req, params }) => {
        const { ids } = await readJson(req);
        if (!Array.isArray(ids) || ids.some(i => typeof i !== 'string')) throw new HttpError(400, 'invalid', 'ids must be a list of ids');
        const type = checkType(params.type);
        app.own(type, null);
        ids.forEach(id => app.own(type, id));
        vault.reorder(type, ids);
        return { ok: true };
    });

    // ── Trash ──
    get('/api/trash', () => vault.listTrash());
    post('/api/trash/:trashId/restore', ({ params }) => {
        const item = vault.restoreItem(params.trashId);
        app.own(item.type, item.id);
        return { item };
    });

    // ── Site text and résumés ──
    put('/api/site', async ({ req }) => {
        const { site } = await readJson(req);
        object(site, 'site');
        app.own('site', null);
        vault.writeSite(site);
        return { ok: true, site: vault.readSite(), siteReadiness: vault.siteReadiness() };
    });
    put('/api/resumes', async ({ req }) => {
        const { resumes } = await readJson(req);
        if (!Array.isArray(resumes)) throw new HttpError(400, 'invalid', 'resumes must be a list');
        app.own('resumes', null);
        vault.writeResumes(resumes);
        return { ok: true, resumes: vault.readResumes(), siteReadiness: vault.siteReadiness() };
    });

    // ── Media ──
    post('/api/upload', async ({ req }) => {
        const type = String(req.headers['x-type'] ?? '');
        const id = String(req.headers['x-id'] ?? '');
        let filename = String(req.headers['x-filename'] ?? '');
        try { filename = decodeURIComponent(filename); } catch { /* use as sent */ }
        filename = path.basename(filename.replace(/\\/g, '/'));
        if (!ITEM_TYPES.includes(type)) throw new HttpError(400, 'invalid', 'x-type must be a collection name');
        if (!ID_RE.test(id)) throw new HttpError(400, 'invalid', 'x-id must be an item id');
        if (!UPLOAD_EXT_RE.test(filename)) throw new HttpError(415, 'unsupported', 'Use an image, GIF, or video file');
        if (Number(req.headers['content-length'] ?? 0) > MAX_UPLOAD_BYTES) throw new HttpError(413, 'too-large', 'That file is over 4 GB');

        const uploads = path.join(app.stateDir, 'uploads');
        fs.mkdirSync(uploads, { recursive: true });
        const tmp = path.join(uploads, crypto.randomBytes(6).toString('hex') + path.extname(filename).toLowerCase());
        try {
            await pipeline(req, fs.createWriteStream(tmp));
        } catch (e) {
            fs.rmSync(tmp, { force: true });
            throw new HttpError(400, 'upload-failed', `Upload interrupted: ${e.message}`);
        }
        app.own('media', null);
        const jobId = app.jobs.enqueue(report => processUpload(app, { tmp, type, id, filename, report }), { kind: 'upload', type, id, filename });
        return { jobId };
    });

    get('/api/jobs/:id', ({ params }) => {
        const job = app.jobs.get(params.id);
        if (!job) throw new HttpError(404, 'not-found', 'No such job');
        return job;
    });

    get('/api/media', ({ url }) => {
        let files = mediaListing(vault);
        if (url.searchParams.get('unused') === '1') files = files.filter(f => !f.usedBy.length);
        return files;
    });

    del('/api/media', async ({ req }) => {
        const { src } = await readJson(req);
        const file = mediaListing(vault).find(f => f.src === src);
        if (!file) throw new HttpError(404, 'not-found', 'No such media file');
        if (file.usedBy.length) throw new HttpError(409, 'in-use', `Still used by ${file.usedBy.map(u => `${u.type}/${u.id}`).join(', ')}`);
        const from = resolveInside(vault.mediaDir, src.replace(/^\/vault-media\//, ''));
        const to = path.join(vault.vaultDir, '_trash', 'media', `${Date.now()}-${path.basename(from)}`);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(from, to);
        app.own('media', null);
        return { ok: true };
    });

    // ── History ──
    const historyFile = (type, id) => {
        checkType(type);
        if (!ID_RE.test(id)) throw new HttpError(400, 'invalid', `Invalid id "${id}"`);
        return MD_TYPES.includes(type) ? `${type}/${id}.md` : `${type}.json`;
    };
    const versionAt = async (type, id, hash) => {
        if (!isHash(hash)) throw new HttpError(400, 'invalid', 'Bad commit id');
        const text = await app.vaultGit.show(hash, historyFile(type, id));
        if (text === null) return null;
        if (MD_TYPES.includes(type)) {
            return parseMd(text);
        }
        const entry = JSON.parse(text).find(e => e.id === id);
        if (!entry) return null;
        const { id: _id, ...data } = entry;
        return { data, body: '' };
    };

    get('/api/history/:type/:id', async ({ params }) => {
        const { type, id } = params;
        const commits = await app.vaultGit.log(historyFile(type, id), MD_TYPES.includes(type) ? 60 : 40);
        if (MD_TYPES.includes(type)) return commits;
        // One file holds every entry, so keep only the commits that changed this one
        const seen = [];
        for (const c of commits) seen.push(JSON.stringify(await versionAt(type, id, c.hash)));
        return commits.filter((_c, i) => seen[i] !== seen[i + 1] && seen[i] !== 'null');
    });
    get('/api/history/:type/:id/:hash', async ({ params }) => {
        const v = await versionAt(params.type, params.id, params.hash);
        if (!v) throw new HttpError(404, 'not-found', 'This item did not exist at that point');
        return v;
    });
    post('/api/history/:type/:id/:hash/restore', async ({ params }) => {
        const v = await versionAt(params.type, params.id, params.hash);
        if (!v) throw new HttpError(404, 'not-found', 'This item did not exist at that point');
        app.own(params.type, params.id);
        return { item: vault.saveItem(params.type, params.id, v.data, v.body) };
    });
    post('/api/checkpoint', async () => ({ hash: await app.checkpoint() }));

    // ── Publish ──
    get('/api/publish/preview', async () => previewFor(app));
    post('/api/publish', async ({ req }) => {
        const opts = await readJson(req);
        return runPublish(app, opts);
    });
    post('/api/golive', async ({ req }) => {
        await readJson(req);
        throw new HttpError(501, 'not-implemented', 'Merging redesign into main is done with Claude/you manually for now.');
    });
    get('/api/deploy', async ({ url }) => app.deploy.get({ fresh: url.searchParams.get('fresh') === '1' }));

    // ── Window control ──
    post('/api/ui/focus', async ({ req }) => {
        const { route = '/' } = await readJson(req);
        if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//')) throw new HttpError(400, 'invalid', 'route must be a path');
        app.hub.send('ui:focus', { route });
        return { ok: true, clients: app.hub.size };
    });
    post('/api/quit', async () => {
        setTimeout(() => app.shutdown(), 50);
        return { ok: true };
    });

    return router;
}

/** Every media file with what uses it. A video's poster counts as used when the video is. */
function mediaListing(vault) {
    const usage = vault.mediaUsage();
    const byRel = new Map(usage.map(f => [f.rel, f]));
    return usage.map(f => {
        let usedBy = f.usedBy;
        const video = f.rel.replace(/\.poster\.webp$/i, '.mp4');
        if (!usedBy.length && video !== f.rel && byRel.has(video)) usedBy = byRel.get(video).usedBy;
        return { src: f.src, bytes: f.bytes, usedBy };
    });
}

async function processUpload(app, { tmp, type, id, filename, report }) {
    try {
        const destDir = path.join(app.vault.mediaDir, type, id);
        let stem = slugify(path.basename(filename, path.extname(filename))) || 'upload';
        const taken = s => ['.webp', '.mp4'].some(ext => fs.existsSync(path.join(destDir, s + ext)));
        const base = stem;
        for (let n = 2; taken(stem); n++) stem = `${base}-${n}`;

        const r = await ingest(tmp, {
            destDir, stem, onProgress: report,
            originalsDir: path.join(app.vault.mediaDir, '_originals', type, id),
        });
        const rel = `${type}/${id}/`;
        return {
            kind: r.kind,
            src: vaultMediaSrc(rel + r.file),
            ...(r.poster ? { poster: vaultMediaSrc(rel + r.poster) } : {}),
            bytes: r.bytes, width: r.width, height: r.height,
            ...(r.duration != null ? { duration: r.duration } : {}),
        };
    } finally {
        fs.rmSync(tmp, { force: true });
    }
}
