#!/usr/bin/env node
/**
 * Astro caches parsed content in .astro/data-store.json and only rebuilds it
 * when content.config.ts itself changes, not when the schema it imports
 * (src/lib/schema.mjs) does. A new field then silently disappears in
 * `astro dev`. Drop the cache when either schema file is newer than it.
 * Runs before `npm run dev` and before the vault app starts its preview.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCHEMA_FILES = ['src/lib/schema.mjs', 'src/content.config.ts'];

export function clearStaleContentCache(root) {
    const store = path.join(root, '.astro', 'data-store.json');
    let storeTime;
    try { storeTime = fs.statSync(store).mtimeMs; } catch { return false; }
    const newest = Math.max(...SCHEMA_FILES.map(f => {
        try { return fs.statSync(path.join(root, f)).mtimeMs; } catch { return 0; }
    }));
    if (newest <= storeTime) return false;
    try { fs.rmSync(store, { force: true }); } catch { return false; }
    return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    if (clearStaleContentCache(root)) console.log('Content schema changed: cleared the Astro content cache.');
}
