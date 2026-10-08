/**
 * Vault launcher: what the "Vault" shortcut runs.
 *
 *   node scripts/vault-app.mjs [--capture] [--route=/x] [--no-open] [server flags...]
 *
 * Starts the vault server hidden if it isn't running, then opens the app in a
 * chromeless Chrome (or Edge) window. If a Vault window is already open it asks
 * that window to navigate instead of opening a second one. Exits when done.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './vault-server/config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, 'vault-server.mjs');
const REPO = path.resolve(HERE, '..');

const LAUNCHER_FLAGS = ['--capture', '--no-open'];
const argv = process.argv.slice(2);
const capture = argv.includes('--capture');
const noOpen = argv.includes('--no-open');
const routeArg = argv.find(a => a.startsWith('--route='))?.slice('--route='.length);
const serverArgs = argv.filter(a => !LAUNCHER_FLAGS.includes(a) && !a.startsWith('--route='));
const opts = parseArgs(serverArgs);
const base = `http://127.0.0.1:${opts.port}`;
const route = routeArg || (capture ? '/capture' : '/');

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ping() {
    try {
        const res = await fetch(`${base}/api/ping`, { signal: AbortSignal.timeout(500) });
        return res.ok ? await res.json() : null;
    } catch { return null; }
}

function startServer() {
    fs.mkdirSync(opts.state, { recursive: true });
    const log = fs.openSync(path.join(opts.state, 'server.log'), 'a');
    const child = spawn(process.execPath, [SERVER, ...serverArgs], {
        cwd: REPO, detached: true, windowsHide: true, stdio: ['ignore', log, log], env: process.env,
    });
    let exited = null;
    child.on('exit', code => { exited = code; });
    child.unref();
    return { child, exited: () => exited };
}

async function waitForServer(handle) {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        const info = await ping();
        if (info) return info;
        if (handle.exited() !== null) throw new Error(`The Vault server stopped right away (exit ${handle.exited()}). See ${path.join(opts.state, 'server.log')}`);
        await sleep(100);
    }
    throw new Error(`The Vault server did not start within 15 seconds. See ${path.join(opts.state, 'server.log')}`);
}

function readToken() {
    try { return fs.readFileSync(path.join(opts.state, 'token'), 'utf8').trim(); } catch { return ''; }
}

/** Chrome first (the app window it opens is the cleanest), then Edge, which ships with Windows. */
function findBrowser() {
    if (process.env.VAULT_BROWSER) return process.env.VAULT_BROWSER;
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean);
    const candidates = [
        ...roots.map(r => path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')),
        ...roots.map(r => path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
    ];
    return candidates.find(p => fs.existsSync(p)) ?? null;
}

function openWindow(url) {
    const browser = findBrowser();
    if (!browser) throw new Error('Could not find Chrome or Edge. Open this address yourself: ' + url);
    // Its own profile keeps the app window separate from her normal browsing
    const child = spawn(browser, [
        `--app=${url}`, '--window-size=1440,900',
        `--user-data-dir=${path.join(opts.state, 'chrome-profile')}`,
        '--no-first-run', '--no-default-browser-check',
    ], { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();
    return browser;
}

async function main() {
    let info = await ping();
    let started = false;
    if (!info) {
        info = await waitForServer(startServer());
        started = true;
    }
    const token = readToken();

    if (!started && info.clients > 0) {
        const res = await fetch(`${base}/api/ui/focus`, {
            method: 'POST', headers: { 'content-type': 'application/json', 'x-vault-token': token },
            body: JSON.stringify({ route }),
        });
        if (res.ok) { console.log(`Vault is already open; sent it to ${route}.`); return; }
    }

    const url = `${base}${route}${token ? `${route.includes('?') ? '&' : '?'}t=${token}` : ''}`;
    if (noOpen) { console.log(url); return; }
    const browser = openWindow(url);
    console.log(`${started ? 'Started Vault server. ' : ''}Opened ${path.basename(browser)} at ${base}${route}`);
}

main().catch(e => {
    console.error(e.message);
    process.exit(1);
});
