#!/usr/bin/env node
/**
 * Guards against private or placeholder content reaching the public site.
 *
 *   node scripts/check-leaks.mjs           check sources (runs as `prebuild`)
 *   node scripts/check-leaks.mjs --dist    check the built site (runs as `postbuild`)
 *
 * Sources: nothing under src/content or src/data may carry vault-only notes
 * or private items.
 * Built site: no placeholder text (lorem, picsum), except on /article/: the
 * Studio Journal demo, whose placeholder text and images are the point.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEXT_EXT = /\.(md|mdx|json|ya?ml|html?|css|m?js|xml|txt|svg|astro)$/i;

const SOURCE_RULES = [
    { re: /(^|[\s"{,])todo"?\s*:/m, why: 'a vault-only `todo` field' },
    { re: /visibility"?\s*:\s*["']?private/i, why: 'a private item' },
    { re: /TODO\(/, why: 'a TODO( marker' },
];
const DIST_RULES = [
    { re: /lorem ipsum|\blorem\b/i, why: 'placeholder text (lorem)' },
    { re: /picsum/i, why: 'placeholder images (picsum)' },
];

/** Built folders that may hold placeholder content on purpose. */
const DEMO_DIRS = new Set(['dist/article']);

function* files(dir, root) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory() && DEMO_DIRS.has(path.relative(root, p).split(path.sep).join('/'))) continue;
        if (e.isDirectory()) yield* files(p, root);
        else if (TEXT_EXT.test(e.name)) yield p;
    }
}

/** Returns a list of human-readable problems. Exported for tests. */
export function findLeaks({ root = ROOT, dist = false } = {}) {
    const problems = [];
    const scan = (dirs, rules) => {
        for (const dir of dirs) {
            for (const file of files(path.join(root, dir), root)) {
                const text = fs.readFileSync(file, 'utf8');
                for (const { re, why } of rules) {
                    if (re.test(text)) problems.push(`${path.relative(root, file).split(path.sep).join('/')}: contains ${why}`);
                }
            }
        }
    };
    if (dist) scan(['dist'], DIST_RULES);
    else scan(['src/content', 'src/data'], SOURCE_RULES);
    return problems;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const dist = process.argv.includes('--dist');
    const problems = findLeaks({ dist });
    if (problems.length) {
        console.error(`Leak check failed (${dist ? 'dist' : 'sources'}):\n${problems.map(p => `  ${p}`).join('\n')}`);
        process.exit(1);
    }
    console.log(`Leak check passed (${dist ? 'dist' : 'sources'}).`);
}
