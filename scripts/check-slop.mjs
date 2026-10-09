#!/usr/bin/env node
/**
 * Design-rule grep for the public site (see the redesign spec): flags styles
 * and patterns the Folio design deliberately avoids. Run via `npm run check`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['src/pages', 'src/layouts', 'src/components', 'src/styles'];

const RULES = [
    { re: /text-transform\s*:\s*uppercase/i, why: 'uppercase transform (use sentence case)' },
    { re: /backdrop-filter/i, why: 'glass / backdrop blur' },
    { re: /(linear|radial|conic)-gradient\(/i, why: 'gradient' },
    { re: /animation[^;{}]*infinite/i, why: 'infinite animation' },
    { re: /Math\.random\(/, why: 'randomness' },
    { re: /box-shadow\s*:\s*-?\d+px\s+-?\d+px\s+0(px)?\s/i, why: 'offset (hard) shadow' },
    { re: /[\p{Emoji_Presentation}\uFE0F]/u, why: 'emoji' },
    { re: /lorem|picsum/i, why: 'placeholder content' },
];

function* files(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) yield* files(p);
        else if (/\.(astro|css|ts|mjs|js)$/.test(e.name)) yield p;
    }
}

// Carried over verbatim from the pre-redesign site at her request.
const EXEMPT = new Set(['src/components/ResumeViewer.astro']);

const problems = [];
for (const dir of DIRS) {
    for (const file of files(path.join(ROOT, dir))) {
        if (EXEMPT.has(path.relative(ROOT, file).split(path.sep).join('/'))) continue;
        fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
            for (const { re, why } of RULES) {
                if (re.test(line)) problems.push(`${path.relative(ROOT, file).split(path.sep).join('/')}:${i + 1}: ${why}`);
            }
        });
    }
}
if (problems.length) {
    console.error(`Design check found ${problems.length} problem(s):\n${problems.map(p => `  ${p}`).join('\n')}`);
    process.exit(1);
}
console.log('Design check passed.');
