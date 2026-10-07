/**
 * vault-lib.mjs: shared logic for the private vault.
 *
 * vault/ (gitignored; its own private git repo) holds everything:
 *   vault/projects/*.md     one file per project
 *   vault/experience/*.md   one file per role
 *   vault/courses.json      [{ id, name, visibility, ... }]
 *   vault/skills.json       [{ id, name, items, visibility, ... }]
 *   vault/media/**          private-first media; reference as /vault-media/<path>
 *
 * publish() copies only `visibility: public` items into src/content/ (and the
 * media they reference into public/vault-media/). That snapshot is what gets
 * committed to the public site repo and built.
 *
 * Frontmatter is written as a YAML subset where every scalar/array value is
 * JSON (valid YAML), so it can be read and patched line-by-line without a
 * YAML dependency. Top-level `key: value` lines are all the admin touches.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT      = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VAULT     = path.join(ROOT, 'vault');
const CONTENT          = path.join(ROOT, 'src/content');
const MEDIA_OUT        = path.join(ROOT, 'public/vault-media');

export const MD_COLLECTIONS   = ['projects', 'experience'];
export const JSON_COLLECTIONS = ['courses', 'skills'];

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

function parseValue(raw) {
    const v = raw.trim();
    if (v === '') return undefined;
    try { return JSON.parse(v); } catch { return v; }
}

/** Top-level `key: value` pairs from a markdown file's frontmatter. */
export function readFrontmatter(text) {
    const m = text.match(FM_RE);
    if (!m) return {};
    const out = {};
    for (const line of m[1].split(/\r?\n/)) {
        const kv = line.match(/^([A-Za-z_][\w]*):(.*)$/);
        if (kv) out[kv[1]] = parseValue(kv[2]);
    }
    return out;
}

/** Set (or add) a top-level frontmatter key, leaving everything else untouched. */
export function patchFrontmatter(text, key, value) {
    const m = text.match(FM_RE);
    if (!m) throw new Error('No frontmatter block');
    const line = `${key}: ${JSON.stringify(value)}`;
    const lineRe = new RegExp(`^${key}:.*$`, 'm');
    const fm = lineRe.test(m[1]) ? m[1].replace(lineRe, line) : `${m[1]}\n${line}`;
    return text.replace(m[1], fm);
}

function vaultExists() {
    return fs.existsSync(VAULT);
}

/** Everything in the vault, grouped by collection, for /admin. */
export function listVault() {
    if (!vaultExists()) return null;
    const out = {};
    for (const c of MD_COLLECTIONS) {
        const dir = path.join(VAULT, c);
        out[c] = !fs.existsSync(dir) ? [] : fs.readdirSync(dir)
            .filter(f => f.endsWith('.md'))
            .map(f => {
                const fm = readFrontmatter(fs.readFileSync(path.join(dir, f), 'utf8'));
                return { id: f.replace(/\.md$/, ''), file: path.join(dir, f), ...fm };
            });
    }
    for (const c of JSON_COLLECTIONS) {
        const p = path.join(VAULT, `${c}.json`);
        out[c] = fs.existsSync(p)
            ? JSON.parse(fs.readFileSync(p, 'utf8')).map(e => ({ ...e, file: p }))
            : [];
    }
    for (const c of Object.keys(out)) {
        out[c].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
    }
    return out;
}

const PATCHABLE = new Set(['visibility', 'featured', 'order']);

/** Apply { key: value } to one vault item. Only admin-safe keys are allowed. */
export function patchItem(collection, id, patch) {
    for (const k of Object.keys(patch)) {
        if (!PATCHABLE.has(k)) throw new Error(`Field "${k}" is not editable from admin`);
    }
    if (MD_COLLECTIONS.includes(collection)) {
        const p = path.join(VAULT, collection, `${path.basename(id)}.md`);
        let text = fs.readFileSync(p, 'utf8');
        for (const [k, v] of Object.entries(patch)) text = patchFrontmatter(text, k, v);
        fs.writeFileSync(p, text);
    } else if (JSON_COLLECTIONS.includes(collection)) {
        const p = path.join(VAULT, `${collection}.json`);
        const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
        const entry = arr.find(e => e.id === id);
        if (!entry) throw new Error(`No ${collection} entry "${id}"`);
        Object.assign(entry, patch);
        fs.writeFileSync(p, JSON.stringify(arr, null, 2) + '\n');
    } else {
        throw new Error(`Unknown collection "${collection}"`);
    }
}

const PROJECT_TEMPLATE = (title) => `---
title: ${JSON.stringify(title)}
hook: ""
visibility: "private"
featured: false
order: 999
disciplines: ["design"]
role: ""
team: ""
engine: ""
duration: ""
status: ""
image: ""
media: []
links: []
tags: []
contribution: []
todo: ["Fill in hook, fact box, contribution bullets, and sections"]
---

## Design

What problem were you solving, what was the goal, and what did you decide?

## Process

Prototypes, playtests, and what changed because of them.

## Technical notes

Systems, code highlights, diagrams. Delete this section if it doesn't apply.

## Outcome and lessons
`;

export function createProject(title) {
    const slug = title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!slug) throw new Error('Title needs at least one letter or number');
    const p = path.join(VAULT, 'projects', `${slug}.md`);
    if (fs.existsSync(p)) throw new Error(`vault/projects/${slug}.md already exists`);
    fs.writeFileSync(p, PROJECT_TEMPLATE(title));
    return { id: slug, file: p };
}

function rmContents(dir, keep = () => false) {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) if (!keep(f)) fs.rmSync(path.join(dir, f), { recursive: true });
}

/** Copy public vault items into src/content/ and their /vault-media/ files into public/. */
export function publish() {
    if (!vaultExists()) throw new Error('vault/ not found; nothing to publish (see vault/README.md)');
    const counts = {};
    const published = [];

    for (const c of MD_COLLECTIONS) {
        const src = path.join(VAULT, c), dst = path.join(CONTENT, c);
        fs.mkdirSync(dst, { recursive: true });
        rmContents(dst);
        let n = 0;
        for (const f of fs.existsSync(src) ? fs.readdirSync(src) : []) {
            if (!f.endsWith('.md')) continue;
            const text = fs.readFileSync(path.join(src, f), 'utf8');
            if (readFrontmatter(text).visibility !== 'public') continue;
            fs.writeFileSync(path.join(dst, f), text);
            published.push(text);
            n++;
        }
        counts[c] = n;
    }

    for (const c of JSON_COLLECTIONS) {
        const src = path.join(VAULT, `${c}.json`);
        const all = fs.existsSync(src) ? JSON.parse(fs.readFileSync(src, 'utf8')) : [];
        const pub = all.filter(e => e.visibility === 'public');
        fs.writeFileSync(path.join(CONTENT, `${c}.json`), JSON.stringify(pub, null, 2) + '\n');
        published.push(JSON.stringify(pub));
        counts[c] = pub.length;
    }

    // Only media that a public item actually references leaves the vault
    rmContents(MEDIA_OUT);
    const refs = new Set(published.join('\n').match(/\/vault-media\/[^\s"'()\]\\]+/g) ?? []);
    const missing = [];
    for (const ref of refs) {
        const rel  = decodeURI(ref.slice('/vault-media/'.length));
        const from = path.join(VAULT, 'media', rel);
        if (!fs.existsSync(from)) { missing.push(ref); continue; }
        const to = path.join(MEDIA_OUT, rel);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
    }
    counts.media = refs.size - missing.length;
    return { counts, missing };
}
