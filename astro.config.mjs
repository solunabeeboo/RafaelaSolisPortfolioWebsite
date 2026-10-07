import { defineConfig } from 'astro/config';
import fs from 'node:fs';
import path from 'node:path';
import * as vault from './scripts/vault-lib.mjs';

/**
 * Vault admin: /admin page + /api/vault/* endpoints, registered ONLY for
 * `astro dev`. Nothing here exists in the production build, so there is no
 * password to leak — the only way in is running the site on your machine.
 */
function vaultAdmin() {
    return {
        name: 'vault-admin',
        hooks: {
            'astro:config:setup': ({ command, injectRoute, updateConfig }) => {
                if (command !== 'dev') return;
                injectRoute({ pattern: '/admin', entrypoint: './src/admin/admin.astro' });
                updateConfig({ vite: { plugins: [vaultApi()] } });
            },
        },
    };
}

const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm', '.pdf': 'application/pdf' };

function vaultApi() {
    const readRaw = req => new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
    const readJson = async req => { const b = await readRaw(req); return b.length ? JSON.parse(b.toString('utf8')) : {}; };

    // Keep src/content in sync after every edit so the local site always
    // shows the current vault (public items only).
    const save = fn => async (...a) => { const r = await fn(...a); vault.publish(); return r ?? { ok: true }; };

    const routes = {
        'GET /':           () => vault.listVault(),
        'PUT /item':       save(async b => vault.saveItem(b.collection, b.id, b.data, b.body)),
        'POST /item':      save(async b => vault.createItem(b.collection, b.title)),
        'DELETE /item':    save(async b => vault.deleteItem(b.collection, b.id)),
        'POST /reorder':   save(async b => vault.reorder(b.collection, b.ids)),
        'GET /site':       () => vault.readSite(),
        'PUT /site':       async b => (vault.writeSite(b), { ok: true }),
        'GET /resumes':    () => vault.readResumes(),
        'PUT /resumes':    async b => (vault.writeResumes(b), { ok: true }),
        'POST /publish':   () => vault.publish(),
        'GET /git':        () => vault.gitStatus(),
        'POST /ship':      b => vault.ship(b.message),
    };

    return {
        name: 'vault-api',
        configureServer(server) {
            // Serve vault media while editing (publish copies public ones to public/vault-media)
            server.middlewares.use('/vault-media', (req, res, next) => {
                const rel = decodeURIComponent(req.url.split('?')[0]);
                const file = path.join(vault.VAULT, 'media', path.normalize(rel).replace(/^([/\\])+/, ''));
                if (!file.startsWith(path.join(vault.VAULT, 'media')) || !fs.existsSync(file)) return next();
                res.setHeader('Content-Type', MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
                fs.createReadStream(file).pipe(res);
            });

            server.middlewares.use('/api/vault', async (req, res) => {
                res.setHeader('Content-Type', 'application/json');
                const send = (status, data) => { res.statusCode = status; res.end(JSON.stringify(data)); };

                // Only the admin page itself may write (blocks other sites
                // posting to localhost while the dev server is running)
                const origin = req.headers.origin;
                if (req.method !== 'GET' && origin && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
                    return send(403, { error: 'Forbidden origin' });
                }

                try {
                    const route = req.url.split('?')[0].replace(/\/$/, '') || '/';
                    if (req.method === 'POST' && route === '/upload') {
                        // Raw file body; metadata in headers so big videos never touch JSON
                        const result = await vault.saveUpload({
                            kind: req.headers['x-kind'],
                            slug: decodeURIComponent(req.headers['x-slug'] || ''),
                            filename: decodeURIComponent(req.headers['x-filename'] || 'file'),
                            buffer: await readRaw(req),
                        });
                        return send(200, result);
                    }
                    const handler = routes[`${req.method} ${route}`];
                    if (!handler) return send(404, { error: 'Not found' });
                    send(200, await handler(req.method === 'GET' ? {} : await readJson(req)));
                } catch (e) {
                    send(500, { error: String(e.message || e) });
                }
            });
        },
    };
}

export default defineConfig({
    site: 'https://rafaelasolis.work',
    output: 'static',
    integrations: [vaultAdmin()],
});
