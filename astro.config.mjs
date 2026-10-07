import { defineConfig } from 'astro/config';
import { listVault, patchItem, publish, createProject } from './scripts/vault-lib.mjs';

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

function vaultApi() {
    const readBody = req => new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    });

    return {
        name: 'vault-api',
        configureServer(server) {
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
                    const route = req.url.split('?')[0];
                    if (req.method === 'GET' && route === '/') {
                        const vault = listVault();
                        return vault ? send(200, vault) : send(404, { error: 'vault/ not found' });
                    }
                    if (req.method === 'POST' && route === '/patch') {
                        // [{ collection, id, patch: { visibility?, featured?, order? } }]
                        for (const p of await readBody(req)) patchItem(p.collection, p.id, p.patch);
                        return send(200, { ok: true });
                    }
                    if (req.method === 'POST' && route === '/publish') {
                        return send(200, publish());
                    }
                    if (req.method === 'POST' && route === '/new') {
                        const { title } = await readBody(req);
                        return send(200, createProject(String(title || '')));
                    }
                    send(404, { error: 'Not found' });
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
