/**
 * The Vault UI: src/vault-ui/main.jsx is bundled with esbuild into <state>/ui,
 * next to src/vault-ui/index.html and any static files. Rebuilt on demand when a
 * source file is newer than the bundle, so editing the UI needs no restart.
 * Until the UI exists, a placeholder page is served.
 */
import fs from 'node:fs';
import path from 'node:path';

const SOURCE_RE = /\.(jsx?|tsx?|mjs)$/i;

const PLACEHOLDER = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vault</title>
<style>body{font:14px system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#f6f6f4;color:#1c1c1a}
@media(prefers-color-scheme:dark){body{background:#161614;color:#ecece8}}main{max-width:32rem;padding:2rem}</style></head>
<body><main><h1>Vault</h1><p>The server is running, but the app screens are not built yet.</p>
<p id="status">Checking connection…</p></main>
<script>fetch('/api/ping').then(r=>r.json()).then(j=>{document.getElementById('status').textContent='Connected (version '+j.version+').'})</script>
</body></html>`;

const DEFAULT_INDEX = hasCss => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vault</title>${hasCss ? '\n<link rel="stylesheet" href="/app.css">' : ''}</head>
<body><div id="app"></div><script type="module" src="/app.js"></script></body></html>`;

function newestMtime(dir) {
    let newest = 0;
    for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
        const p = path.join(dir, e.name);
        newest = Math.max(newest, e.isDirectory() ? newestMtime(p) : fs.statSync(p).mtimeMs);
    }
    return newest;
}

function copyStatic(from, to) {
    for (const e of fs.readdirSync(from, { withFileTypes: true })) {
        const src = path.join(from, e.name), dest = path.join(to, e.name);
        if (e.isDirectory()) { fs.mkdirSync(dest, { recursive: true }); copyStatic(src, dest); }
        else if (!SOURCE_RE.test(e.name)) fs.copyFileSync(src, dest);
    }
}

export function createUi({ repoRoot, stateDir }) {
    // VAULT_UI_SRC lets tests serve a tiny fixture instead of the real screens
    const srcDir = process.env.VAULT_UI_SRC ? path.resolve(process.env.VAULT_UI_SRC) : path.join(repoRoot, 'src', 'vault-ui');
    const outDir = path.join(stateDir, 'ui');
    const marker = path.join(outDir, '.built');
    let pending = null;
    let lastError = null;

    async function build() {
        fs.rmSync(outDir, { recursive: true, force: true });
        fs.mkdirSync(outDir, { recursive: true });
        lastError = null;
        const entry = path.join(srcDir, 'main.jsx');
        if (!fs.existsSync(entry)) {
            fs.writeFileSync(path.join(outDir, 'index.html'), PLACEHOLDER);
            return;
        }
        try {
            const { build: esbuild } = await import('esbuild');
            await esbuild({
                entryPoints: [entry], outfile: path.join(outDir, 'app.js'),
                bundle: true, format: 'esm', target: 'es2022', jsx: 'automatic', jsxImportSource: 'preact',
                sourcemap: 'inline', logLevel: 'silent', absWorkingDir: repoRoot,
                loader: { '.svg': 'text' },
            });
            copyStatic(srcDir, outDir);
            if (!fs.existsSync(path.join(outDir, 'index.html'))) {
                fs.writeFileSync(path.join(outDir, 'index.html'), DEFAULT_INDEX(fs.existsSync(path.join(outDir, 'app.css'))));
            }
        } catch (e) {
            lastError = String(e.errors?.map(x => `${x.location?.file ?? ''}:${x.location?.line ?? ''} ${x.text}`).join('\n') || e.message || e);
        }
        fs.writeFileSync(marker, '');
    }

    const isStale = () => {
        if (!fs.existsSync(marker) && !fs.existsSync(path.join(outDir, 'index.html'))) return true;
        const built = fs.existsSync(marker) ? fs.statSync(marker).mtimeMs : fs.statSync(path.join(outDir, 'index.html')).mtimeMs;
        return newestMtime(srcDir) > built;
    };

    return {
        outDir,
        get error() { return lastError; },
        /** Make sure the bundle is current. Concurrent callers share one build. */
        async ensure({ force = false } = {}) {
            if (pending) return pending;
            if (!force && !isStale()) return;
            pending = build().finally(() => { pending = null; });
            return pending;
        },
        /** Absolute file inside the bundle for a URL path, or null. */
        resolve(pathname) {
            const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
            const file = path.resolve(outDir, rel);
            if (file !== outDir && !file.startsWith(outDir + path.sep)) return null;
            return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
        },
    };
}
