/**
 * vault-lib.mjs: everything the admin and CLI do to the private vault.
 *
 * vault/ (gitignored here; its own private git repo) holds everything:
 *   vault/projects/<slug>.md     frontmatter (YAML) + case-study body
 *   vault/experience/<slug>.md
 *   vault/courses.json, vault/skills.json   arrays of { id, ... }
 *   vault/media/**               uploads, referenced as /vault-media/<path>
 *
 * publish() mirrors only `visibility: public` items into src/content/ and
 * copies the /vault-media files they reference into public/vault-media/.
 * That snapshot is what the public site builds from.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import YAML from 'yaml';

export const ROOT   = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VAULT  = path.join(ROOT, 'vault');
const CONTENT       = path.join(ROOT, 'src/content');
const MEDIA_OUT     = path.join(ROOT, 'public/vault-media');
const SITE_JSON     = path.join(ROOT, 'src/data/site.json');
const RESUMES_JSON  = path.join(ROOT, 'src/data/resumes.json');

export const MD_COLLECTIONS   = ['projects', 'experience'];
export const JSON_COLLECTIONS = ['courses', 'skills'];
const isMd   = c => MD_COLLECTIONS.includes(c);
const isJson = c => JSON_COLLECTIONS.includes(c);

// ── Markdown + frontmatter ────────────────────────────────────────────────
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/;

export function parseMd(text) {
    const m = text.match(FM_RE);
    if (!m) return { data: {}, body: text };
    return { data: YAML.parse(m[1]) ?? {}, body: m[2].replace(/^\s*\n/, '') };
}

// Drop empty optional fields so files stay tidy (title/hook always kept)
function tidy(data) {
    const out = {};
    for (const [k, v] of Object.entries(data)) {
        if (v === undefined || v === null) continue;
        if (v === '' && k !== 'title' && k !== 'hook') continue;
        if (typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(x => !x)) continue;
        out[k] = v;
    }
    return out;
}

export function stringifyMd(data, body = '') {
    return `---\n${YAML.stringify(tidy(data), { lineWidth: 0 })}---\n\n${body.trim()}\n`;
}

const readJson  = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');

/** Write only if different, so the dev server doesn't reload for nothing. */
function writeIfChanged(p, text) {
    if (fs.existsSync(p) && fs.readFileSync(p, 'utf8') === text) return false;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
    return true;
}

export const slugify = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function requireVault() {
    if (!fs.existsSync(VAULT)) throw new Error('vault/ not found (clone your private portfolio-vault repo into ./vault)');
}

// ── Read ──────────────────────────────────────────────────────────────────
const byOrder = (a, b) => (a.data?.order ?? a.order ?? 999) - (b.data?.order ?? b.order ?? 999);

export function listVault() {
    requireVault();
    const out = {};
    for (const c of MD_COLLECTIONS) {
        const dir = path.join(VAULT, c);
        out[c] = (fs.existsSync(dir) ? fs.readdirSync(dir) : [])
            .filter(f => f.endsWith('.md'))
            .map(f => ({ id: f.slice(0, -3), ...parseMd(fs.readFileSync(path.join(dir, f), 'utf8')) }))
            .sort(byOrder);
    }
    for (const c of JSON_COLLECTIONS) {
        const p = path.join(VAULT, `${c}.json`);
        out[c] = (fs.existsSync(p) ? readJson(p) : []).sort(byOrder);
    }
    return out;
}

// ── Write ─────────────────────────────────────────────────────────────────
const mdPath = (c, id) => path.join(VAULT, c, `${path.basename(id)}.md`);

export function saveItem(collection, id, data, body) {
    requireVault();
    if (isMd(collection)) {
        writeIfChanged(mdPath(collection, id), stringifyMd(data, body));
    } else if (isJson(collection)) {
        const p = path.join(VAULT, `${collection}.json`);
        const arr = fs.existsSync(p) ? readJson(p) : [];
        const i = arr.findIndex(e => e.id === id);
        const entry = { ...tidy(data), id };
        if (i < 0) arr.push(entry); else arr[i] = entry;
        writeJson(p, arr);
    } else {
        throw new Error(`Unknown collection "${collection}"`);
    }
}

const TEMPLATES = {
    projects: title => ({
        data: { title, hook: '', visibility: 'private', featured: false, order: 0, disciplines: ['design'],
            media: [], links: [], tags: [], contribution: [] },
        body: '## Design\n\nThe problem, the goal, the decision.\n\n## Process\n\nPrototypes, playtests, and what changed because of them.\n\n## Outcome and lessons\n',
    }),
    experience: title => ({ data: { title, org: '', start: '', end: 'Present', visibility: 'private', order: 0, bullets: [] }, body: '' }),
    courses: name => ({ data: { name, visibility: 'private', order: 0, disciplines: [] } }),
    skills: name => ({ data: { name, visibility: 'private', order: 0, wide: false, items: [] } }),
};

/** New items start private and at the top of their list. */
export function createItem(collection, title) {
    requireVault();
    const make = TEMPLATES[collection];
    if (!make) throw new Error(`Unknown collection "${collection}"`);
    const base = slugify(title);
    if (!base) throw new Error('Give it a name with at least one letter or number');
    const existing = new Set(listVault()[collection].map(i => i.id));
    let id = base, n = 2;
    while (existing.has(id)) id = `${base}-${n++}`;
    const { data, body } = make(title);
    saveItem(collection, id, data, body ?? '');
    return { id };
}

/** Deleted md files go to vault/_trash/ (still in the vault's git history too). */
export function deleteItem(collection, id) {
    requireVault();
    if (isMd(collection)) {
        const from = mdPath(collection, id);
        const to = path.join(VAULT, '_trash', collection, `${path.basename(id)}-${Date.now()}.md`);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(from, to);
    } else if (isJson(collection)) {
        const p = path.join(VAULT, `${collection}.json`);
        writeJson(p, readJson(p).filter(e => e.id !== id));
    }
}

export function reorder(collection, ids) {
    requireVault();
    if (isMd(collection)) {
        ids.forEach((id, i) => {
            const p = mdPath(collection, id);
            const { data, body } = parseMd(fs.readFileSync(p, 'utf8'));
            data.order = i + 1;
            writeIfChanged(p, stringifyMd(data, body));
        });
    } else if (isJson(collection)) {
        const p = path.join(VAULT, `${collection}.json`);
        const arr = readJson(p);
        for (const e of arr) e.order = ids.indexOf(e.id) + 1 || 999;
        writeJson(p, arr.sort(byOrder));
    }
}

// ── Site text + resumes (public files in the site repo) ───────────────────
export const readSite     = () => readJson(SITE_JSON);
export const writeSite    = v => writeJson(SITE_JSON, v);
export const readResumes  = () => readJson(RESUMES_JSON);
export const writeResumes = v => writeJson(RESUMES_JSON, v);

// ── Uploads ───────────────────────────────────────────────────────────────
const RASTER = /\.(png|jpe?g|webp|bmp|tiff?)$/i;

/**
 * Save an upload and return the URL the site should use.
 *   kind "project": vault/media/projects/<slug>/…  → /vault-media/projects/<slug>/…
 *   kind "site":    public/images/…                → /images/…   (headshot etc.)
 *   kind "resume":  public/resume/<name>.pdf       → /resume/<name>.pdf
 * Raster images are converted to WebP (max 2000px wide) — small and sharp.
 */
export async function saveUpload({ kind, slug, filename, buffer }) {
    let name = path.basename(filename).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+/, '') || 'file';
    let data = buffer;
    if (RASTER.test(name) && kind !== 'resume') {
        const sharp = (await import('sharp')).default;
        data = await sharp(buffer).rotate().resize({ width: 2000, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
        name = name.replace(RASTER, '.webp');
    }

    let dir, url;
    if (kind === 'project') {
        const s = slugify(slug || 'misc');
        dir = path.join(VAULT, 'media', 'projects', s);
        url = `/vault-media/projects/${s}/`;
    } else if (kind === 'resume') {
        if (!/\.pdf$/i.test(name)) throw new Error('Resumes must be PDFs');
        name = `rafaela-solis-resume-${slugify(slug || 'new')}.pdf`;
        dir = path.join(ROOT, 'public', 'resume');
        url = '/resume/';
    } else {
        dir = path.join(ROOT, 'public', 'images');
        url = '/images/';
    }
    fs.mkdirSync(dir, { recursive: true });

    // Never overwrite a different file that happens to share the name
    // (resumes are the exception: replacing them is the point)
    if (kind !== 'resume') {
        const ext = path.extname(name), stem = name.slice(0, -ext.length || undefined);
        let n = 2;
        while (fs.existsSync(path.join(dir, name)) && !fs.readFileSync(path.join(dir, name)).equals(data)) {
            name = `${stem}-${n++}${ext}`;
        }
    }
    fs.writeFileSync(path.join(dir, name), data);
    return { url: url + encodeURIComponent(name).replace(/%2F/g, '/'), bytes: data.length };
}

// ── Publish ───────────────────────────────────────────────────────────────
export function publish() {
    requireVault();
    const counts = {};
    const published = [];

    for (const c of MD_COLLECTIONS) {
        const src = path.join(VAULT, c), dst = path.join(CONTENT, c);
        fs.mkdirSync(dst, { recursive: true });
        const keep = new Set();
        for (const f of fs.existsSync(src) ? fs.readdirSync(src) : []) {
            if (!f.endsWith('.md')) continue;
            const text = fs.readFileSync(path.join(src, f), 'utf8');
            if (parseMd(text).data.visibility !== 'public') continue;
            writeIfChanged(path.join(dst, f), text);
            keep.add(f);
            published.push(text);
        }
        for (const f of fs.readdirSync(dst)) if (!keep.has(f)) fs.rmSync(path.join(dst, f));
        counts[c] = keep.size;
    }

    for (const c of JSON_COLLECTIONS) {
        const src = path.join(VAULT, `${c}.json`);
        const pub = (fs.existsSync(src) ? readJson(src) : []).filter(e => e.visibility === 'public');
        writeIfChanged(path.join(CONTENT, `${c}.json`), JSON.stringify(pub, null, 2) + '\n');
        published.push(JSON.stringify(pub));
        counts[c] = pub.length;
    }

    // Only media a public item references leaves the vault
    const refs = new Set(published.join('\n').match(/\/vault-media\/[^\s"'()\]\\,]+/g) ?? []);
    const wanted = new Set();
    const missing = [];
    for (const ref of refs) {
        const rel = decodeURIComponent(ref.slice('/vault-media/'.length));
        const from = path.join(VAULT, 'media', rel);
        if (!fs.existsSync(from)) { missing.push(ref); continue; }
        const to = path.join(MEDIA_OUT, rel);
        wanted.add(path.normalize(to));
        if (!fs.existsSync(to) || fs.statSync(to).size !== fs.statSync(from).size) {
            fs.mkdirSync(path.dirname(to), { recursive: true });
            fs.copyFileSync(from, to);
        }
    }
    // Remove media no longer referenced by anything public
    (function prune(dir) {
        if (!fs.existsSync(dir)) return;
        for (const f of fs.readdirSync(dir)) {
            const p = path.join(dir, f);
            if (fs.statSync(p).isDirectory()) { prune(p); if (!fs.readdirSync(p).length) fs.rmdirSync(p); }
            else if (!wanted.has(path.normalize(p))) fs.rmSync(p);
        }
    })(MEDIA_OUT);

    counts.media = wanted.size;
    return { counts, missing };
}

// ── Git ───────────────────────────────────────────────────────────────────
function git(cwd, args) {
    return new Promise((resolve, reject) =>
        execFile('git', args, { cwd, maxBuffer: 1 << 24 }, (err, stdout, stderr) =>
            err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout.trim())));
}

async function repoStatus(cwd) {
    if (!fs.existsSync(path.join(cwd, '.git'))) return null;
    const [branch, changes] = await Promise.all([
        git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
        git(cwd, ['status', '--porcelain']),
    ]);
    return { branch, changed: changes ? changes.split('\n').length : 0 };
}

export async function gitStatus() {
    return { site: await repoStatus(ROOT), vault: await repoStatus(VAULT) };
}

/** Publish, then commit + push the site repo and the vault repo. */
export async function ship(message) {
    const msg = (message || 'Update portfolio content').trim();
    publish();
    const log = [];
    for (const [name, cwd, paths] of [
        ['site', ROOT, ['src/content', 'src/data', 'public']],
        ['vault', VAULT, ['-A']],
    ]) {
        if (!fs.existsSync(path.join(cwd, '.git'))) continue;
        await git(cwd, ['add', ...paths]);
        const staged = await git(cwd, ['diff', '--cached', '--name-only']);
        if (!staged) { log.push(`${name}: nothing to commit`); continue; }
        await git(cwd, ['commit', '-m', msg]);
        const branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
        await git(cwd, ['push', 'origin', branch]);
        log.push(`${name}: committed ${staged.split('\n').length} file(s) and pushed to ${branch}`);
    }
    return { log };
}
