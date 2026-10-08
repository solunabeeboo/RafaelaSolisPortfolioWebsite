/**
 * Publish: write the public snapshot, check the site still builds, commit the
 * vault and then the site, push both. Refuses to push `main` unless the caller
 * says `confirmLive`, and refuses files over 50 MB (GitHub's soft limit).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PUBLISH_PATHS } from '../vault-lib.mjs';
import { HttpError } from './http.mjs';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export async function previewFor(app) {
    const preview = app.vault.previewPublish();
    const branch = await app.siteGit.branch();
    return { ...preview, branch, willDeploy: branch === 'main' };
}

/** Run `node <args>` in the site repo; resolves with the output tail, rejects with it on failure. */
function runNode(args, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } });
        let tail = '';
        const take = c => { tail = (tail + c).slice(-4000); };
        child.stdout.on('data', take);
        child.stderr.on('data', take);
        const timer = setTimeout(() => child.kill(), 15 * 60_000);
        child.on('error', e => { clearTimeout(timer); reject(e); });
        child.on('close', code => {
            clearTimeout(timer);
            const lines = tail.trim().split(/\r?\n/).slice(-12).join('\n');
            code === 0 ? resolve(lines) : reject(new Error(lines || `exited ${code}`));
        });
    });
}

async function bigFiles(git, paths) {
    const found = [];
    // Checkpoints commit with `git add -A`, so a big file may already be committed rather than changed
    if (!paths.length) {
        for (const { file, size } of await git.bigInHead(MAX_FILE_BYTES)) found.push(`${file} (${Math.round(size / 1048576)} MB)`);
    }
    for (const { file, deleted } of await git.changedFiles(paths)) {
        if (deleted) continue;
        try {
            const size = fs.statSync(path.join(git.cwd, file)).size;
            if (size > MAX_FILE_BYTES) found.push(`${file} (${Math.round(size / 1048576)} MB)`);
        } catch { /* vanished between status and stat */ }
    }
    return found;
}

export async function runPublish(app, { message, confirmLive = false, skipBuild = false, prerender = true } = {}) {
    if (!app.siteGit.isRepo()) throw new HttpError(409, 'no-repo', 'The site folder is not a git repository');
    const branch = await app.siteGit.branch();
    if (branch === 'main' && confirmLive !== true) {
        throw new HttpError(403, 'main-protected', 'This would push main, which is the live site. Use Go live and type "live" to confirm.');
    }
    if (app.publishing) throw new HttpError(409, 'busy', 'A publish is already running');
    app.publishing = true;
    // The guard above only holds for this branch: refuse to commit or push if it changes during the build
    const sameBranch = async git => {
        const now = await git.branch();
        if (now !== branch) throw new Error(`The site branch changed from ${branch} to ${now} during the publish; nothing more was committed or pushed.`);
    };

    const steps = [];
    let pushedSite = false;
    let summary = null;
    const commitMessage = (message && String(message).trim()) || `Publish ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;

    /** Run one step, record it, stream it. Returns false (and stops the publish) if it failed. */
    const step = async (name, fn) => {
        app.hub.send('publish:step', { name, status: 'running' });
        try {
            const detail = await fn();
            steps.push({ name, ok: true, detail: detail ?? '' });
        } catch (e) {
            steps.push({ name, ok: false, detail: String(e.message ?? e) });
        }
        app.hub.send('publish:step', { name, status: steps.at(-1).ok ? 'ok' : 'failed', detail: steps.at(-1).detail });
        return steps.at(-1).ok;
    };

    try {
        const run = async () => {
            if (!await step('write', async () => {
                const r = await app.vault.publish({
                    prerender,
                    onStep: (name, detail) => app.hub.send('publish:step', { name: `write:${name}`, status: 'running', detail }),
                });
                summary = { counts: r.counts, skipped: r.skipped, warnings: r.warnings, failed: r.failed };
                const n = Object.entries(r.counts).map(([k, v]) => `${v} ${k}`).join(', ');
                return `${n}; ${r.written.length} files written, ${r.removed.length} removed${r.skipped.length ? `; ${r.skipped.length} skipped` : ''}${r.failed.length ? `; could not remove: ${r.failed.join(' | ')}` : ''}`;
            })) return;

            if (!skipBuild && !await step('build', async () => {
                await runNode(['scripts/check-leaks.mjs'], app.siteRoot);
                await runNode([path.join('node_modules', 'astro', 'astro.js'), 'build'], app.siteRoot);
                await runNode(['scripts/check-leaks.mjs', '--dist'], app.siteRoot);
                return 'Site builds';
            })) return;

            if (!await step('size-check', async () => {
                const big = [...await bigFiles(app.vaultGit, []), ...await bigFiles(app.siteGit, PUBLISH_PATHS)];
                if (big.length) throw new Error(`Over the 50 MB limit: ${big.join(', ')}. Shrink or remove ${big.length === 1 ? 'it' : 'them'} and publish again.`);
                return 'No file over 50 MB';
            })) return;

            if (!await step('commit-vault', async () => {
                if (!app.vaultGit.isRepo()) return 'Vault is not a git repository; nothing to commit';
                const hash = await app.vaultGit.commit(commitMessage);
                return hash ? `Committed ${hash}` : 'Nothing new to commit';
            })) return;

            if (!await step('commit-site', async () => {
                await sameBranch(app.siteGit);
                const hash = await app.siteGit.commit(commitMessage, { paths: PUBLISH_PATHS });
                return hash ? `Committed ${hash} on ${branch}` : 'Nothing new to commit';
            })) return;

            const push = (git, label) => async () => {
                if (!git.isRepo()) return `${label} is not a git repository; not pushed`;
                if (!await git.hasRemote()) return `No remote named origin; committed locally only`;
                if (git === app.siteGit) await sameBranch(git);
                const b = await git.branch();
                await git.push(b);
                if (git === app.siteGit) pushedSite = true;
                return `Pushed ${b}`;
            };
            if (!await step('push-vault', push(app.vaultGit, 'Vault'))) return;
            await step('push-site', push(app.siteGit, 'Site'));
        };
        await run();
    } finally {
        app.publishing = false;
    }

    const failed = steps.find(s => !s.ok);
    const deployed = !failed && pushedSite && branch === 'main';
    if (deployed) app.deploy.invalidate();

    let text;
    if (failed) text = `Stopped at "${failed.name}": ${failed.detail}`;
    else if (branch !== 'main') text = `Saved to ${branch}. Not live — the live site deploys from main.`;
    else if (deployed) text = 'Pushed to main. The live site updates when the deploy finishes.';
    else text = 'Committed on main, but nothing was pushed (no remote).';
    if (!failed && summary?.failed?.length) text += ` Could not remove old folders: ${summary.failed.join('; ')}`;

    return { ok: !failed, steps, deployed, branch, message: text, summary };
}
