/**
 * Vault server: the local backend for the Vault app.
 *
 *   node scripts/vault-server.mjs [--port 4319] [--no-astro] [--no-token] ...
 *
 * Serves the UI, a JSON API and server-sent events on 127.0.0.1, runs
 * `astro dev` for the live preview, and commits the vault as she works.
 * Flags are documented in scripts/vault-server/config.mjs. VAULT_DIR picks the vault.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createVault, ensureVaultIgnore } from './vault-lib.mjs';
import { REPO_ROOT, parseArgs } from './vault-server/config.mjs';
import { HttpError, sendJson, toHttpError } from './vault-server/http.mjs';
import { createSecurity } from './vault-server/security.mjs';
import { createHub } from './vault-server/events.mjs';
import { createGit } from './vault-server/git.mjs';
import { createJobs } from './vault-server/jobs.mjs';
import { createUi } from './vault-server/ui.mjs';
import { createAstro } from './vault-server/astro.mjs';
import { createDeployStatus } from './vault-server/deploy.mjs';
import { watchVault } from './vault-server/watch.mjs';
import { createRoutes } from './vault-server/routes.mjs';
import { resolveInside, serveFile } from './vault-server/files.mjs';

const VERSION = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version;

const CSP = [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
    "media-src 'self' blob:", "font-src 'self' data:", "connect-src 'self'",
    'frame-src http://127.0.0.1:* http://localhost:*', "object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'",
].join('; ');

export async function startServer(options = parseArgs()) {
    const vaultDir = path.resolve(process.env.VAULT_DIR || path.join(REPO_ROOT, 'vault'));
    if (!fs.existsSync(vaultDir)) throw new Error(`Vault not found at ${vaultDir}`);
    const { port, site: siteRoot, state: stateDir } = options;
    fs.mkdirSync(stateDir, { recursive: true });
    try { if (fs.existsSync(path.join(vaultDir, '.git'))) ensureVaultIgnore(vaultDir); } catch { /* read-only vault: checkpoints still work */ }

    const hub = createHub();
    const security = createSecurity({ port, requireToken: options.token });
    const logFile = path.join(stateDir, 'server.log');
    const log = msg => { try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`); } catch { /* logging is best effort */ } };

    const app = {
        vault: createVault({ vaultDir, siteRoot }),
        vaultDir, siteRoot, stateDir, hub, publishing: false,
        vaultGit: createGit(vaultDir),
        siteGit: createGit(siteRoot),
        jobs: createJobs(hub),
        deploy: createDeployStatus(siteRoot),
        json: sendJson,
        astro: null,
    };

    // Our own saves would otherwise echo back as "changed on disk"
    const recentWrites = new Map();
    app.own = (type, id) => recentWrites.set(`${type}/${id ?? ''}`, Date.now());
    const isOwnWrite = ({ type, id }) => {
        const t = Math.max(recentWrites.get(`${type}/${id ?? ''}`) ?? 0, recentWrites.get(`${type}/`) ?? 0);
        return Date.now() - t < 1200;
    };

    // ── Checkpoints: commit the vault shortly after the last change ──
    let checkpointTimer = null;
    app.checkpoint = async () => {
        clearTimeout(checkpointTimer);
        if (!app.vaultGit.isRepo()) return null;
        try {
            const hash = await app.vaultGit.checkpoint();
            if (hash) hub.send('checkpoint', { hash });
            return hash;
        } catch (e) { log(`checkpoint failed: ${e.message}`); return null; }
    };
    const dirty = () => {
        clearTimeout(checkpointTimer);
        checkpointTimer = setTimeout(() => app.checkpoint(), options.checkpointMs);
    };

    const ui = createUi({ repoRoot: REPO_ROOT, stateDir });
    const routes = createRoutes(app);
    await ui.ensure({ force: true });

    // ── Requests ──
    async function handle(req, res) {
        const url = new URL(req.url, `http://127.0.0.1:${port}`);
        const method = req.method === 'HEAD' ? 'GET' : req.method;
        res.setHeader('x-content-type-options', 'nosniff');
        res.setHeader('referrer-policy', 'no-referrer');
        res.setHeader('content-security-policy', CSP);

        security.checkHost(req);
        if (url.pathname === '/api/ping' && method === 'GET') {
            return sendJson(res, 200, { ok: true, version: VERSION, clients: hub.size, pid: process.pid });
        }
        security.checkOrigin(req);

        // Launch link: trade ?t=<token> for a cookie, then drop it from the URL
        if (method === 'GET' && url.searchParams.has('t')) {
            const cookie = security.cookieFor(url.searchParams.get('t'));
            if (cookie) {
                url.searchParams.delete('t');
                res.writeHead(302, { 'set-cookie': cookie, location: url.pathname + url.search, 'cache-control': 'no-store' });
                return res.end();
            }
        }

        const isApi = url.pathname.startsWith('/api/');
        if (isApi || url.pathname.startsWith('/vault-media/')) security.requireAuth(req);

        if (url.pathname.startsWith('/vault-media/')) {
            if (method !== 'GET') throw new HttpError(405, 'method-not-allowed');
            const file = resolveInside(app.vault.mediaDir, url.pathname.slice('/vault-media/'.length));
            return serveFile(req, res, file);
        }

        if (isApi) {
            const { handler, params, pathMatched } = routes.match(method, url.pathname);
            if (!handler) throw pathMatched ? new HttpError(405, 'method-not-allowed') : new HttpError(404, 'not-found', 'No such endpoint');
            const result = await handler({ req, res, url, params });
            if (method !== 'GET' && !['/api/publish', '/api/checkpoint', '/api/ui/focus', '/api/quit'].includes(url.pathname)) dirty();
            if (!res.headersSent) sendJson(res, 200, result ?? { ok: true });
            return;
        }

        // The app itself
        if (method !== 'GET') throw new HttpError(405, 'method-not-allowed');
        if (!security.isAuthed(req)) {
            res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
            return res.end('Open Vault from its shortcut to sign in.');
        }
        await ui.ensure();
        if (ui.error) {
            res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
            return res.end(`The Vault screens failed to build:\n\n${ui.error}`);
        }
        const file = ui.resolve(url.pathname) ?? (path.extname(url.pathname) ? null : ui.resolve('/'));
        if (!file) throw new HttpError(404, 'not-found', 'No such file');
        return serveFile(req, res, file, { cacheControl: 'no-store' });
    }

    const server = http.createServer((req, res) => {
        handle(req, res).catch(e => {
            const err = toHttpError(e);
            if (err.status >= 500) log(`${req.method} ${req.url}: ${e.stack ?? e}`);
            if (res.headersSent) return res.destroy();
            sendJson(res, err.status, { error: err.error, ...(err.detail ? { detail: err.detail } : {}), ...err.extra });
        });
    });
    server.requestTimeout = 0; // uploads can be large and slow

    // ── Lifecycle ──
    let idleTimer = null;
    let closing = null;
    const armIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            // Closing the window must not end a publish or a transcode half way
            if (app.publishing || app.jobs.busy()) { log('idle but busy; waiting'); return armIdle(); }
            log('idle; shutting down');
            app.shutdown();
        }, options.idleMs);
    };
    hub.onChange(n => (n === 0 ? armIdle() : clearTimeout(idleTimer)));

    const watcher = watchVault(vaultDir, {
        isOwnWrite,
        onChange: change => { hub.send('fs:changed', change); dirty(); },
    });

    app.shutdown = ({ exit = true } = {}) => {
        closing ??= (async () => {
            clearTimeout(idleTimer);
            watcher.close();
            hub.send('shutdown', {});
            await app.checkpoint();
            app.astro?.stop();
            hub.close();
            server.closeAllConnections?.();
            await new Promise(r => server.close(r));
            fs.rmSync(path.join(stateDir, 'server.json'), { force: true });
            fs.rmSync(path.join(stateDir, 'uploads'), { recursive: true, force: true });
            if (exit) process.exit(0);
        })();
        return closing;
    };

    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', resolve);
    });

    // The launcher reads the token from here
    if (security.token) fs.writeFileSync(path.join(stateDir, 'token'), security.token);
    else fs.rmSync(path.join(stateDir, 'token'), { force: true });
    fs.writeFileSync(path.join(stateDir, 'server.json'), JSON.stringify({ pid: process.pid, port }));
    fs.rmSync(path.join(stateDir, 'uploads'), { recursive: true, force: true });
    armIdle();

    if (options.astro) {
        app.astro = createAstro({
            siteRoot, vaultDir, preferredPort: options.astroPort,
            onChange: s => hub.send('preview:status', s), log,
            // Media URLs in the preview point back at this server; the token gates the preview routes
            env: { VAULT_ORIGIN: `http://127.0.0.1:${port}`, ...(security.token ? { VAULT_PREVIEW_TOKEN: security.token } : {}) },
        });
        app.astro.start();
    }

    log(`listening on 127.0.0.1:${port}; vault ${vaultDir}; site ${siteRoot}`);
    return { app, server, port, token: security.token, close: opts => app.shutdown({ exit: false, ...opts }) };
}

// Run directly: node scripts/vault-server.mjs
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    try {
        const { app } = await startServer(parseArgs());
        const stop = () => app.shutdown();
        process.on('SIGINT', stop);
        process.on('SIGTERM', stop);
        process.on('SIGBREAK', stop);
        console.log(`Vault server ready on http://127.0.0.1:${parseArgs().port}`);
    } catch (e) {
        console.error(e.code === 'EADDRINUSE' ? `Port ${parseArgs().port} is already in use. Is Vault already running?` : e.message);
        process.exit(1);
    }
}
