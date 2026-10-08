/**
 * Git for one repo (the vault, or the site). Commands run one at a time so two
 * requests never fight over index.lock.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';

const FALLBACK_IDENTITY = ['-c', 'user.name=Vault', '-c', 'user.email=vault@localhost'];

export function createGit(cwd) {
    let queue = Promise.resolve();
    let identity;

    const exec = (args, { timeout = 120_000, env } = {}) => new Promise((resolve, reject) => {
        execFile('git', args, {
            cwd, timeout, maxBuffer: 64 * 1024 * 1024, windowsHide: true,
            env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env },
        }, (err, stdout, stderr) => {
            if (err) reject(Object.assign(new Error((stderr || err.message).trim()), { code: err.code, stdout, stderr }));
            else resolve(stdout);
        });
    });

    /** Serialized git call; resolves with stdout (not trimmed). */
    const run = (args, opts) => {
        const p = queue.then(() => exec(args, opts));
        queue = p.catch(() => {});
        return p;
    };

    const isRepo = () => fs.existsSync(path.join(cwd, '.git'));

    async function who() {
        if (identity) return identity;
        try {
            const name = (await exec(['config', 'user.name'])).trim();
            const email = (await exec(['config', 'user.email'])).trim();
            identity = name && email ? [] : FALLBACK_IDENTITY;
        } catch { identity = FALLBACK_IDENTITY; }
        return identity;
    }

    return {
        cwd, run, isRepo,

        async branch() {
            if (!isRepo()) return null;
            return (await run(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
        },

        async hasRemote(name = 'origin') {
            return (await run(['remote'])).split(/\r?\n/).includes(name);
        },

        /** Changed or untracked files, optionally limited to some paths. `deleted` files have no size. */
        async changedFiles(paths = []) {
            const out = await run(['status', '--porcelain', '-z', '-uall', ...(paths.length ? ['--', ...paths] : [])]);
            const parts = out.split('\0').filter(Boolean);
            const files = [];
            for (let i = 0; i < parts.length; i++) {
                const status = parts[i].slice(0, 2), file = parts[i].slice(3);
                if (status[0] === 'R' || status[0] === 'C') i++; // next entry is the old name
                files.push({ file, status, deleted: status.includes('D') });
            }
            return files;
        },

        /** Stage (everything, or only `paths`) and commit. Resolves with the new hash, or null if nothing changed. */
        async commit(message, { paths = [] } = {}) {
            if (paths.length) {
                // git refuses a pathspec that matches nothing, e.g. public/media before any video exists
                const known = [];
                for (const p of paths) {
                    if (fs.existsSync(path.join(cwd, p)) || (await run(['ls-files', '--', p])).trim()) known.push(p);
                }
                paths = known;
                if (!paths.length) return null;
            }
            await run(['add', '-A', ...(paths.length ? ['--', ...paths] : [])]);
            const staged = (await run(['diff', '--cached', '--name-only', ...(paths.length ? ['--', ...paths] : [])])).trim();
            if (!staged) return null;
            const ident = await who();
            await run([...ident, 'commit', '-m', message, '--no-verify', ...(paths.length ? ['--only', '--', ...paths] : [])]);
            return (await run(['rev-parse', '--short', 'HEAD'])).trim();
        },

        /** `git add -A && git commit -m "Checkpoint <ISO>"`. Null if the tree is clean. */
        checkpoint() {
            return this.commit(`Checkpoint ${new Date().toISOString()}`);
        },

        /** Files at HEAD over `limit` bytes: catches big files that a checkpoint already committed. */
        async bigInHead(limit) {
            if (!isRepo()) return [];
            let out;
            try { out = await run(['ls-tree', '-r', '-l', 'HEAD']); } catch { return []; } // no commits yet
            const found = [];
            for (const line of out.split(/\r?\n/)) {
                const m = /^\S+ blob \S+\s+(\d+)\t(.+)$/.exec(line);
                if (m && Number(m[1]) > limit) found.push({ file: m[2], size: Number(m[1]) });
            }
            return found;
        },

        async push(branch) {
            await run(['push', '-u', 'origin', branch], { timeout: 300_000 });
        },

        async log(file, limit = 60) {
            const out = await run(['log', `-n${limit}`, '--format=%H%x1f%aI%x1f%s', '--', file]);
            return out.split(/\r?\n/).filter(Boolean).map(line => {
                const [hash, date, message] = line.split('\x1f');
                return { hash, date, message };
            });
        },

        /** File content at a commit, or null if it didn't exist there. */
        async show(hash, file) {
            try { return await run(['show', `${hash}:${file}`]); }
            catch { return null; }
        },
    };
}

export const isHash = h => /^[0-9a-f]{7,40}$/i.test(h);
