import { defineConfig } from 'astro/config';

/**
 * Dev-only preview of a vault project at /__preview/projects/<slug>. It renders
 * through the same case-study component as the public page but reads the vault
 * (VAULT_DIR), so private drafts can be previewed. Not registered for builds.
 */
function vaultPreview() {
    return {
        name: 'vault-preview',
        hooks: {
            'astro:config:setup': ({ command, injectRoute }) => {
                if (command !== 'dev') return;
                injectRoute({ pattern: '/__preview/projects/[slug]', entrypoint: './src/vault-preview/project.astro' });
            },
            // Private drafts must not be readable by any local client: the Vault server hands us its
            // launch token, and the preview needs the same cookie (set on 127.0.0.1, so any port).
            'astro:server:setup': ({ server }) => {
                const token = process.env.VAULT_PREVIEW_TOKEN;
                if (!token) return;
                server.middlewares.use((req, res, next) => {
                    if (!String(req.url).startsWith('/__preview')) return next();
                    const cookie = String(req.headers.cookie ?? '').split(';').map(c => c.trim().split('=')).find(([k]) => k === 'vault_t');
                    if (cookie && cookie.slice(1).join('=') === token) return next();
                    res.statusCode = 401;
                    res.setHeader('content-type', 'text/plain; charset=utf-8');
                    res.end('Open this preview from Vault.');
                });
            },
        },
    };
}

export default defineConfig({
    site: 'https://rafaelasolis.work',
    output: 'static',
    integrations: [vaultPreview()],
    devToolbar: { enabled: false },
    build: { inlineStylesheets: 'always' },
    prefetch: { prefetchAll: true, defaultStrategy: 'hover' },
    // Screenshots must never be cropped (HUDs): contain by default.
    image: { objectFit: 'contain', objectPosition: 'center' },
});
