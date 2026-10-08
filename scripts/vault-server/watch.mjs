/** Watches the vault for edits made outside the app (her editor, a git pull) and reports which item changed. */
import fs from 'node:fs';
import { MD_TYPES, JSON_TYPES } from '../vault-lib.mjs';

const IGNORED = /(^|[\\/])(\.git|_trash|_originals|chrome-profile)([\\/]|$)|\.tmp$|\.part\.mp4$/;

/** Vault-relative path to `{ type, id }`, or null if it isn't an item. */
export function describeChange(rel) {
    const parts = rel.split(/[\\/]/);
    if (MD_TYPES.includes(parts[0]) && parts.length === 2 && parts[1].endsWith('.md')) return { type: parts[0], id: parts[1].slice(0, -3) };
    if (parts.length === 1) {
        const name = parts[0].replace(/\.json$/, '');
        if (JSON_TYPES.includes(name)) return { type: name, id: null };
        if (name === 'site' || name === 'resumes') return { type: name, id: null };
    }
    if (parts[0] === 'media') return { type: 'media', id: null };
    if (parts[0] === 'resumes') return { type: 'resumes', id: null };
    return null;
}

/**
 * `onChange({ type, id })` is debounced per file. `isOwnWrite(change)` lets the
 * server skip echoes of its own saves.
 */
export function watchVault(vaultDir, { onChange, isOwnWrite = () => false, wait = 150 }) {
    const timers = new Map();
    let watcher;
    try {
        watcher = fs.watch(vaultDir, { recursive: true }, (_event, name) => {
            if (!name || IGNORED.test(name)) return;
            const change = describeChange(name);
            if (!change) return;
            const key = `${change.type}/${change.id ?? ''}`;
            clearTimeout(timers.get(key));
            timers.set(key, setTimeout(() => {
                timers.delete(key);
                if (!isOwnWrite(change)) onChange(change);
            }, wait));
        });
        watcher.on('error', () => {}); // the folder can vanish while the vault is being moved
    } catch { /* unsupported platform: edits are picked up on the next refresh */ }
    return { close() { watcher?.close(); timers.forEach(clearTimeout); } };
}
