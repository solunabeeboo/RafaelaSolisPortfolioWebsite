/** Runs `astro dev` as a child for the live preview; restarts it if it dies. */
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { clearStaleContentCache } from '../content-cache.mjs';

export function createAstro({ siteRoot, vaultDir, preferredPort, onChange, log = () => {}, env = {} }) {
    let child = null;
    let stopped = false;
    let crashes = [];
    let timer = null;
    const state = { running: false, url: null };

    const set = patch => { Object.assign(state, patch); onChange?.({ ...state }); };

    function start() {
        if (stopped || child) return;
        const bin = path.join(siteRoot, 'node_modules', 'astro', 'astro.js');
        if (clearStaleContentCache(siteRoot)) log('Content schema changed: cleared the Astro content cache');
        child = spawn(process.execPath, [bin, 'dev', '--port', String(preferredPort), '--host', '127.0.0.1'], {
            cwd: siteRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, VAULT_DIR: vaultDir, FORCE_COLOR: '0', NO_COLOR: '1', ...env },
        });
        const onData = chunk => {
            const text = String(chunk);
            log(text.trimEnd());
            const m = /Local\s+(http:\/\/[^\s/]+:\d+)/.exec(text);
            if (m) set({ running: true, url: m[1] });
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.on('exit', code => {
            child = null;
            set({ running: false, url: null });
            if (stopped) return;
            const now = Date.now();
            crashes = [...crashes.filter(t => now - t < 60_000), now];
            if (crashes.length > 5) { log(`astro dev exited (${code}) too often; giving up`); return; }
            timer = setTimeout(start, 1000 * crashes.length);
        });
    }

    return {
        state,
        start,
        stop() {
            stopped = true;
            clearTimeout(timer);
            if (!child) return;
            const pid = child.pid;
            // Kill the whole tree on Windows; a plain kill can leave vite's workers behind
            if (process.platform === 'win32') execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
            else child.kill();
        },
    };
}
