/** Fixtures for the vault server tests: a temp vault, a temp site repo, a running server. Not a test file. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { tmpDir } from './data-helpers.mjs';

export const REPO = path.resolve(import.meta.dirname, '..');
const SCRATCH = 'C:/Users/rafa/AppData/Local/Temp/claude/H--College-Work-RafaelaSolisPortfolioWebsite/33a56202-1e6b-4c0e-8939-b7924d114476/scratchpad';
/** The migrated vault the server tests copy. Override with VAULT_FIXTURE. */
export const FIXTURE_VAULT = process.env.VAULT_FIXTURE || path.join(SCRATCH, 'vault-migrated');

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe', windowsHide: true }).toString().trim();
const IDENT = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com'];

/**
 * A fresh vault in a temp dir with its own new git repo and one commit.
 * Big media (over `maxMediaBytes`) and the old site/originals are left out so
 * the copy stays quick; the items and small images are real.
 */
export function makeVault({ maxMediaBytes = 400 * 1024, branch = 'main' } = {}) {
    const dir = path.join(tmpDir('vault-srv'), 'vault');
    fs.cpSync(FIXTURE_VAULT, dir, {
        recursive: true,
        filter: src => {
            const rel = path.relative(FIXTURE_VAULT, src).split(path.sep).join('/');
            if (rel === '.git' || rel.startsWith('.git/') || rel.startsWith('legacy-site') || rel.startsWith('media/_originals') || rel.startsWith('chrome-profile')) return false;
            if (rel.startsWith('media/') && fs.statSync(src).isFile() && fs.statSync(src).size > maxMediaBytes) return false;
            return true;
        },
    });
    fs.writeFileSync(path.join(dir, '.gitignore'), 'chrome-profile/\nmedia/_originals/\n*.part.mp4\n*.tmp\n');
    git(dir, 'init', '-q', '-b', branch);
    git(dir, 'add', '-A');
    git(dir, ...IDENT, 'commit', '-q', '-m', 'Baseline');
    return dir;
}

/** A throwaway site repo on `branch`, with a bare "origin" when `remote` is true. */
export function makeSite({ branch = 'redesign', remote = false } = {}) {
    const root = tmpDir('site-srv');
    const dir = path.join(root, 'site');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.md'), 'test site\n');
    git(dir, 'init', '-q', '-b', branch);
    git(dir, 'add', '-A');
    git(dir, ...IDENT, 'commit', '-q', '-m', 'Initial');
    let bare = null;
    if (remote) {
        bare = path.join(root, 'origin.git');
        git(root, 'init', '-q', '--bare', '-b', branch, bare);
        git(dir, 'remote', 'add', 'origin', bare);
    }
    return { dir, bare, git: (...a) => git(dir, ...a) };
}

export function addRemote(repoDir, name = 'origin') {
    const bare = path.join(tmpDir('remote'), `${name}.git`);
    git(path.dirname(bare), 'init', '-q', '--bare', bare);
    git(repoDir, 'remote', 'add', 'origin', bare);
    return bare;
}

export const gitIn = git;

/** Start the server as a child process and wait until it answers. */
export async function startServer({ port, vaultDir, siteDir, flags = ['--no-astro', '--no-token'], env = {} }) {
    const state = tmpDir('state-srv');
    const args = [path.join(REPO, 'scripts/vault-server.mjs'), '--port', String(port), '--site', siteDir, '--state', state, ...flags];
    const child = spawn(process.execPath, args, {
        cwd: REPO, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, VAULT_DIR: vaultDir, VAULT_UI_SRC: path.join(REPO, 'tests/fixtures/vault-ui-min'), ...env },
    });
    let output = '';
    child.stdout.on('data', c => { output += c; });
    child.stderr.on('data', c => { output += c; });
    let exited = null;
    child.on('exit', code => { exited = code; });

    const base = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 30_000;
    for (;;) {
        if (exited !== null) throw new Error(`Server exited ${exited}: ${output}`);
        try { if ((await fetch(base + '/api/ping')).ok) break; } catch { /* not up yet */ }
        if (Date.now() > deadline) { child.kill(); throw new Error(`Server did not start: ${output}`); }
        await new Promise(r => setTimeout(r, 100));
    }

    const server = {
        base, state, child, port,
        get output() { return output; },
        get exitCode() { return exited; },
        async stop() {
            if (exited !== null) return;
            await fetch(base + '/api/quit', { method: 'POST' }).catch(() => {});
            const until = Date.now() + 8000;
            while (exited === null && Date.now() < until) await new Promise(r => setTimeout(r, 50));
            if (exited === null) child.kill();
        },
        /** JSON request; resolves `{ status, body, headers }` without throwing on 4xx. */
        async api(method, route, body, headers = {}) {
            const res = await fetch(base + route, {
                method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
                body: body !== undefined ? JSON.stringify(body) : undefined,
            });
            const text = await res.text();
            let json = null;
            try { json = JSON.parse(text); } catch { /* not json */ }
            return { status: res.status, body: json, text, headers: res.headers };
        },
        get: (route, headers) => server.api('GET', route, undefined, headers),
        put: (route, body) => server.api('PUT', route, body),
        post: (route, body) => server.api('POST', route, body ?? {}),
        del: (route, body) => server.api('DELETE', route, body),
    };
    return server;
}

/** A raw request where we control Host/Origin, which fetch() will not let us set. */
export function rawRequest({ port, method = 'GET', path: p = '/', headers = {}, body }) {
    return new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, method, path: p, headers }, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
        });
        req.on('error', reject);
        req.end(body);
    });
}

/** Resolve with the first SSE event named `name` (optionally matching `predicate`). */
export async function waitForEvent(base, name, predicate = () => true, { timeout = 20_000, headers = {} } = {}) {
    const ac = new AbortController();
    const res = await fetch(base + '/api/events', { signal: ac.signal, headers });
    const timer = setTimeout(() => ac.abort(), timeout);
    const decoder = new TextDecoder();
    let buf = '';
    try {
        for await (const chunk of res.body) {
            buf += decoder.decode(chunk, { stream: true });
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
                const frame = buf.slice(0, i);
                buf = buf.slice(i + 2);
                const ev = /^event: (.+)$/m.exec(frame)?.[1];
                const data = /^data: (.+)$/m.exec(frame)?.[1];
                if (ev === name && data && predicate(JSON.parse(data))) return JSON.parse(data);
            }
        }
    } catch (e) {
        if (e.name !== 'AbortError') throw e;
    } finally {
        clearTimeout(timer);
        ac.abort();
    }
    throw new Error(`Timed out waiting for SSE event "${name}"`);
}

export async function pollJob(server, jobId, timeout = 120_000) {
    const end = Date.now() + timeout;
    for (;;) {
        const { body } = await server.get(`/api/jobs/${jobId}`);
        if (body.status === 'done' || body.status === 'error') return body;
        if (Date.now() > end) throw new Error('Job timed out');
        await new Promise(r => setTimeout(r, 100));
    }
}
