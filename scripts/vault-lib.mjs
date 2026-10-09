/**
 * vault-lib.mjs: everything the vault app and the CLI do to the private vault.
 *
 * The vault (VAULT_DIR, default <repo>/vault; gitignored here, its own private
 * git repo) holds plain files:
 *   projects/*.md  experience/*.md  awards/*.md   frontmatter (YAML) + markdown body
 *   notes/*.md  inbox/*.md                        always private, never published
 *   courses.json  skills.json                     arrays of { id, ... }
 *   site.json  resumes.json                       page copy, resume list
 *   media/**                                      referenced as /vault-media/<path>
 *   resumes/**                                    resume PDFs
 *   _trash/**                                     deleted items (restorable)
 *
 * `publish()` mirrors only public, error-free items (allowlisted fields only)
 * into the site repo: src/content, src/data, src/assets/media, public/media,
 * public/resume. That snapshot is all the public build ever reads.
 *
 * Everything is exposed both as `createVault({ vaultDir, siteRoot })` (used by
 * tests) and as top-level functions bound to VAULT_DIR / the repo root.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import YAML from 'yaml';
import {
    MD_TYPES, JSON_TYPES, ITEM_TYPES, PUBLISHABLE_TYPES, publicKeys, publicSchema, resumesSchema, coerceScalars,
} from '../src/lib/schema.mjs';
import { mediaRefs, mediaRel, normalizeMedia, posterSrcFor, publishedPath } from '../src/lib/media.mjs';
import { readiness } from '../src/lib/readiness.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VAULT_DIR = path.resolve(process.env.VAULT_DIR || path.join(ROOT, 'vault'));
/** @deprecated alias kept for older callers */
export const VAULT = VAULT_DIR;

export { MD_TYPES, JSON_TYPES, ITEM_TYPES, PUBLISHABLE_TYPES };
export const MD_COLLECTIONS = MD_TYPES;
export const JSON_COLLECTIONS = JSON_TYPES;

/** Site-repo paths that publish writes. A vault-app commit stages exactly these. */
// public/projects and public/vault-media are pre-vault folders that publish deletes while they are
// still tracked; listing them stages those deletions (a path that matches nothing is skipped).
export const PUBLISH_PATHS = ['src/content', 'src/data', 'src/assets/media', 'public/media', 'public/resume', 'public/projects', 'public/vault-media'];

/** Windows PowerShell 5.1 writes a BOM with `Out-File` / `Set-Content -Encoding UTF8`. */
export const stripBom = text => (typeof text === 'string' && text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text);

// ── Markdown + frontmatter ────────────────────────────────────────────────
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/;

/** Throws on invalid YAML. A file without frontmatter is all body. */
export function parseMd(text) {
    text = stripBom(text);
    const m = text.match(FM_RE);
    if (!m) return { data: {}, body: text };
    const data = YAML.parse(m[1]) ?? {};
    if (typeof data !== 'object' || Array.isArray(data)) throw new Error('Frontmatter must be a set of key: value pairs');
    // Exactly one blank separator line belongs to the file format, not the body
    return { data, body: m[2].replace(/^\r?\n/, '') };
}

/** Drop empty optional fields so files stay tidy. Required text fields are always kept. */
export function tidy(data) {
    const out = {};
    for (const [k, v] of Object.entries(data)) {
        if (v === undefined || v === null) continue;
        if (v === '' && !['title', 'hook', 'name'].includes(k)) continue;
        if (typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(x => !x)) continue;
        out[k] = v;
    }
    return out;
}

/** Block-style YAML frontmatter. The body is written exactly as given. */
export function stringifyMd(data, body = '', { tidy: doTidy = true } = {}) {
    const fm = doTidy ? tidy(data) : data;
    // A file with nothing to say in frontmatter stays plain text rather than gaining "---, {}, ---"
    if (!Object.keys(fm).length) return body;
    const yaml = YAML.stringify(fm, { lineWidth: 0 });
    return `---\n${yaml}---\n${body === '' ? '' : '\n' + body}`;
}

export const slugify = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const sha1 = buf => crypto.createHash('sha1').update(buf).digest('hex');
const readJsonFile = p => JSON.parse(stripBom(fs.readFileSync(p, 'utf8')));
const stableJson = v => JSON.stringify(v, null, 2) + '\n';
/** Key-order-independent form, for comparing JSON entries. */
const canonical = v => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));

/** Write to a temp file then rename, so a crash never leaves a half-written file. */
export function atomicWrite(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, content);
    for (let attempt = 0; ; attempt++) {
        try { fs.renameSync(tmp, file); return; }
        catch (e) {
            // Windows: a watcher or antivirus can briefly hold the target
            if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) { fs.rmSync(tmp, { force: true }); throw e; }
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40 * (attempt + 1));
        }
    }
}

/** Write only if different (keeps the dev server from reloading for nothing). */
function writeIfChanged(file, content) {
    const next = typeof content === 'string' ? Buffer.from(content) : content;
    if (fs.existsSync(file) && fs.readFileSync(file).equals(next)) return false;
    atomicWrite(file, content);
    return true;
}

function sameFileContents(a, b) {
    if (fs.statSync(a).size !== fs.statSync(b).size) return false;
    return fs.readFileSync(a).equals(fs.readFileSync(b));
}

export class StaleError extends Error {
    constructor(item) { super('stale'); this.name = 'StaleError'; this.item = item; }
}

const byOrder = (a, b) => (a.data.order ?? 999) - (b.data.order ?? 999) || a.id.localeCompare(b.id);
const itemTitle = (type, data) => data.title ?? data.name ?? '';
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

/** Lines the vault's .gitignore must have: originals stay local, ffmpeg scratch files never reach history. */
export const VAULT_IGNORE = ['chrome-profile/', 'media/_originals/', '*.part.mp4', '*.tmp'];

/** Add any missing VAULT_IGNORE lines to <vaultDir>/.gitignore. Returns the lines added. */
export function ensureVaultIgnore(vaultDir) {
    const file = path.join(vaultDir, '.gitignore');
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const have = new Set(text.split(/\r?\n/).map(l => l.trim().replace(/^\//, '')));
    const missing = VAULT_IGNORE.filter(l => !have.has(l) && !have.has(l.replace(/\/$/, '')));
    if (missing.length) atomicWrite(file, (text && !text.endsWith('\n') ? text + '\n' : text) + missing.join('\n') + '\n');
    return missing;
}

/** Strip vault-only parts of a body (HTML comments are notes to self). */
export function publicBody(body) {
    if (!body.includes('<!--')) return body;
    return body.replace(HTML_COMMENT_RE, '').replace(/\n{3,}/g, '\n\n').replace(/^\s*\n/, '');
}

/** Only allowlisted keys, no empties, no hidden media: the shape that is safe to publish. */
export function publicData(type, data) {
    const allowed = new Set(publicKeys(type));
    const out = {};
    // Keep the author's key order so frontmatter reads the way she wrote it
    for (const key of Object.keys(data)) {
        if (!allowed.has(key)) continue;
        let v = data[key];
        if (v === undefined || v === null || v === '') continue;
        if (Array.isArray(v) && !v.length) continue;
        if (key === 'media' && Array.isArray(v)) {
            v = v.filter(m => !(m && typeof m === 'object' && m.hidden === true))
                .map(m => {
                    if (!m || typeof m !== 'object') return m;
                    const { hidden: _hidden, ...rest } = m;
                    return Object.fromEntries(Object.entries(rest).filter(([, x]) => x !== undefined && x !== ''));
                });
        }
        out[key] = v;
    }
    return { ...out, visibility: 'public' };
}

/** Zod issues as readiness-style errors. */
function schemaErrors(type, data) {
    const r = publicSchema(type).safeParse(data);
    return r.success ? [] : r.error.issues.map(i => ({ field: i.path.join('.') || type, msg: i.message }));
}

// ── Templates for new items ───────────────────────────────────────────────
// New items start private and at the top of their list.
const TEMPLATES = {
    projects:   title => ({ data: { title, hook: '', visibility: 'private', featured: false, order: 0, disciplines: [], media: [], links: [], tags: [], contribution: [] } }),
    experience: title => ({ data: { title, org: '', start: '', end: 'Present', visibility: 'private', order: 0, bullets: [] } }),
    awards:     title => ({ data: { title, visibility: 'private', order: 0, disciplines: [] } }),
    notes:      title => ({ data: { title, tags: [] } }),
    inbox:      title => ({ data: { title, created: new Date().toISOString() } }),
    courses:    title => ({ data: { name: title, visibility: 'private', order: 0, disciplines: [] } }),
    skills:     title => ({ data: { name: title, visibility: 'private', order: 0, wide: false, items: [] } }),
};

// ── The vault ─────────────────────────────────────────────────────────────

export function createVault({ vaultDir = VAULT_DIR, siteRoot = ROOT } = {}) {
    const V = path.resolve(vaultDir);
    const S = path.resolve(siteRoot);
    const mediaDir = path.join(V, 'media');
    const isMd = t => MD_TYPES.includes(t);
    const isJson = t => JSON_TYPES.includes(t);
    const need = () => { if (!fs.existsSync(V)) throw new Error(`Vault not found at ${V}`); };
    const checkType = t => { if (!ITEM_TYPES.includes(t)) throw new Error(`Unknown collection "${t}"`); };
    const safeId = id => {
        if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) throw new Error(`Invalid id "${id}"`);
        return id;
    };
    const mdFile = (t, id) => path.join(V, t, `${safeId(id)}.md`);
    const jsonFile = t => path.join(V, `${t}.json`);
    const rel = p => path.relative(V, p).split(path.sep).join('/');

    // ── Readiness context ──
    function makeCtx(projectIds) {
        const inMedia = r => path.join(mediaDir, ...r.split('/'));
        return {
            projectIds,
            mediaExists: r => fs.existsSync(inMedia(r)),
            mediaBytes: r => { try { return fs.statSync(inMedia(r)).size; } catch { return null; } },
            resumeExists: f => {
                const p = path.resolve(V, f);
                return p.startsWith(V + path.sep) && fs.existsSync(p);
            },
        };
    }

    // ── Reading ──
    function readMdItem(type, id) {
        const file = mdFile(type, id);
        const stat = fs.statSync(file);
        const { data, body } = parseMd(fs.readFileSync(file, 'utf8'));
        return { type, id, data: coerceScalars(type, data), body, mtime: stat.mtimeMs };
    }

    /** `{ items, broken }`: one bad file never hides the others. */
    function listRaw(type) {
        checkType(type);
        const items = [], broken = [];
        if (isMd(type)) {
            const dir = path.join(V, type);
            for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
                if (!f.endsWith('.md')) continue;
                try { items.push(readMdItem(type, f.slice(0, -3))); }
                catch (e) { broken.push({ file: `${type}/${f}`, error: String(e.message ?? e).split('\n')[0] }); }
            }
        } else {
            const file = jsonFile(type);
            if (fs.existsSync(file)) {
                try {
                    const arr = readJsonFile(file);
                    if (!Array.isArray(arr)) throw new Error('Expected a list');
                    for (const e of arr) {
                        const { id, ...data } = e;
                        // Entries share one file, so their version is a hash of the entry itself:
                        // saving one course must not make the others look stale.
                        const mtime = parseInt(sha1(canonical(e)).slice(0, 12), 16);
                        items.push({ type, id: id || slugify(data.name ?? ''), data: coerceScalars(type, data), body: '', mtime });
                    }
                } catch (e) { broken.push({ file: `${type}.json`, error: String(e.message ?? e).split('\n')[0] }); }
            }
        }
        return { items: items.sort(byOrder), broken };
    }

    /** Readiness plus the schema errors publish enforces, so the editor shows what will block. */
    function readinessFor(type, data, body, ctx) {
        const r = readiness(type, { ...data, body }, ctx);
        const seen = new Set(r.errors.map(e => e.field));
        const extra = schemaErrors(type, PUBLISHABLE_TYPES.includes(type) ? publicData(type, data) : data)
            .filter(e => !seen.has(e.field) && !(e.field === type));
        return extra.length ? { ...r, errors: [...r.errors, ...extra] } : r;
    }

    function withReadiness(items, ctx) {
        return items.map(it => ({ ...it, readiness: readinessFor(it.type, it.data, it.body, ctx) }));
    }

    const publicProjectIds = () => new Set(listRaw('projects').items.filter(p => p.data.visibility === 'public').map(p => p.id));

    function listItems(type) {
        const { items, broken } = listRaw(type);
        return { items: withReadiness(items, makeCtx(publicProjectIds())), broken };
    }

    function getItem(type, id) {
        const found = listRaw(type).items.find(i => i.id === id);
        if (!found) throw Object.assign(new Error(`${type}/${id} not found`), { code: 'ENOENT' });
        return withReadiness([found], makeCtx(publicProjectIds()))[0];
    }

    const readSite = () => (fs.existsSync(path.join(V, 'site.json')) ? readJsonFile(path.join(V, 'site.json')) : {});
    const readResumes = () => (fs.existsSync(path.join(V, 'resumes.json')) ? readJsonFile(path.join(V, 'resumes.json')) : []);

    function siteReadiness(ctx = makeCtx(publicProjectIds())) {
        return readiness('site', { site: readSite(), resumes: readResumes() }, ctx);
    }

    /** Everything the app shows, in one read. */
    function loadAll() {
        need();
        const ctx = makeCtx(publicProjectIds());
        const collections = {}, broken = [];
        for (const t of ITEM_TYPES) {
            const r = listRaw(t);
            collections[t] = withReadiness(r.items, ctx);
            broken.push(...r.broken);
        }
        let site = {}, resumes = [];
        try { site = readSite(); } catch (e) { broken.push({ file: 'site.json', error: String(e.message) }); }
        try { resumes = readResumes(); } catch (e) { broken.push({ file: 'resumes.json', error: String(e.message) }); }
        return { collections, site, resumes, broken, siteReadiness: readiness('site', { site, resumes }, ctx) };
    }

    // ── Writing ──
    function writeJsonEntries(type, mutate) {
        const file = jsonFile(type);
        const arr = fs.existsSync(file) ? readJsonFile(file) : [];
        const next = mutate(arr) ?? arr;
        atomicWrite(file, stableJson(next));
    }

    /**
     * Save an item. With `baseMtime`, refuses (StaleError) when the file changed
     * since the caller loaded it. Unknown keys are kept.
     */
    function saveItem(type, id, data, body = '', { baseMtime } = {}) {
        need(); checkType(type); safeId(id);
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Item data must be an object');
        if (baseMtime != null) {
            const existing = listRaw(type).items.find(i => i.id === id);
            if (existing && existing.mtime !== baseMtime) throw new StaleError(getItem(type, id));
        }
        if (isMd(type)) {
            atomicWrite(mdFile(type, id), stringifyMd(data, body));
        } else {
            const entry = { ...tidy(data), id };
            writeJsonEntries(type, arr => {
                const i = arr.findIndex(e => e.id === id);
                if (i < 0) arr.push(entry); else arr[i] = entry;
            });
        }
        return getItem(type, id);
    }

    const uniqueId = (type, base) => {
        const existing = new Set(listRaw(type).items.map(i => i.id));
        let id = base, n = 2;
        while (existing.has(id)) id = `${base}-${n++}`;
        return id;
    };

    /** New item from a title; slug is unique within the collection. */
    function createItem(type, { title, data = {}, body = '' } = {}) {
        need(); checkType(type);
        const base = slugify(title ?? '');
        if (!base) throw new Error('Give it a name with at least one letter or number');
        const id = uniqueId(type, base);
        const tpl = TEMPLATES[type](title);
        return saveItem(type, id, { ...tpl.data, ...data }, body);
    }

    function renameItem(type, id, newId) {
        need(); checkType(type);
        const next = slugify(newId);
        if (!next) throw new Error('Invalid new id');
        if (next === id) return getItem(type, id);
        if (listRaw(type).items.some(i => i.id === next)) throw new Error(`"${next}" already exists`);
        const item = getItem(type, id);
        if (isMd(type)) {
            fs.renameSync(mdFile(type, id), mdFile(type, next));
        } else {
            writeJsonEntries(type, arr => { arr.find(e => e.id === id).id = next; });
        }
        // Awards point at projects by slug
        if (type === 'projects') {
            for (const a of listRaw('awards').items.filter(a => a.data.project === id)) {
                saveItem('awards', a.id, { ...a.data, project: next }, a.body);
            }
        }
        return getItem(type, next);
    }

    // Trash ids look like `projects~bender-man~1700000000000`
    const trashDir = path.join(V, '_trash');

    /** Move an item to _trash. Returns the id to restore it with. */
    function deleteItem(type, id) {
        need(); checkType(type);
        const ts = Date.now();
        const trashId = `${type}~${safeId(id)}~${ts}`;
        const dest = path.join(trashDir, type, `${id}-${ts}.${isMd(type) ? 'md' : 'json'}`);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        if (isMd(type)) {
            fs.renameSync(mdFile(type, id), dest);
        } else {
            const arr = readJsonFile(jsonFile(type));
            const entry = arr.find(e => e.id === id);
            if (!entry) throw Object.assign(new Error(`${type}/${id} not found`), { code: 'ENOENT' });
            atomicWrite(dest, stableJson(entry));
            writeJsonEntries(type, a => a.filter(e => e.id !== id));
        }
        return trashId;
    }

    function trashEntry(trashId) {
        const m = /^([a-z]+)~([a-z0-9-]+)~(\d+)$/i.exec(trashId);
        if (!m || !ITEM_TYPES.includes(m[1])) throw new Error('Invalid trash id');
        const [, type, id, ts] = m;
        const file = path.join(trashDir, type, `${id}-${ts}.${isMd(type) ? 'md' : 'json'}`);
        if (!fs.existsSync(file)) throw Object.assign(new Error('Not in trash'), { code: 'ENOENT' });
        return { type, id, ts: Number(ts), file };
    }

    function listTrash() {
        const out = [];
        for (const type of ITEM_TYPES) {
            const dir = path.join(trashDir, type);
            for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
                const m = /^(.+)-(\d+)\.(md|json)$/.exec(f);
                if (!m) continue;
                let title = m[1];
                try {
                    const text = fs.readFileSync(path.join(dir, f), 'utf8');
                    const data = m[3] === 'md' ? parseMd(text).data : JSON.parse(stripBom(text));
                    title = itemTitle(type, data) || title;
                } catch { /* unreadable: list it by id */ }
                out.push({ trashId: `${type}~${m[1]}~${m[2]}`, type, id: m[1], title, deletedAt: Number(m[2]) });
            }
        }
        return out.sort((a, b) => b.deletedAt - a.deletedAt);
    }

    function restoreItem(trashId) {
        need();
        const { type, id, file } = trashEntry(trashId);
        const newId = uniqueId(type, id);
        if (isMd(type)) {
            fs.mkdirSync(path.join(V, type), { recursive: true });
            fs.renameSync(file, mdFile(type, newId));
        } else {
            const entry = readJsonFile(file);
            writeJsonEntries(type, arr => { arr.push({ ...entry, id: newId }); });
            fs.rmSync(file);
        }
        return getItem(type, newId);
    }

    /** File an inbox capture as a project, award or note. */
    function fileInbox(id, toType) {
        need();
        if (!['projects', 'awards', 'notes'].includes(toType)) throw new Error(`Can't file as "${toType}"`);
        const cap = getItem('inbox', id);
        const extra = {};
        if (cap.data.url) {
            if (toType === 'projects') extra.links = [{ label: 'Link', url: cap.data.url }];
            else extra.url = cap.data.url;
        }
        if (toType === 'projects' && cap.data.attachments?.length) extra.media = cap.data.attachments;
        const created = createItem(toType, { title: cap.data.title, data: extra, body: cap.body });
        deleteItem('inbox', id);
        return created;
    }

    /** Dense 1..n `order` for the ids given, in that sequence. */
    function reorder(type, ids) {
        need(); checkType(type);
        if (isMd(type)) {
            // Read everything first: a missing or unparsable file must not leave a half-applied order
            const loaded = ids.map(id => {
                safeId(id);
                if (!fs.existsSync(mdFile(type, id))) throw new Error(`No ${type} item "${id}"`);
                return { id, ...parseMd(fs.readFileSync(mdFile(type, id), 'utf8')) };
            });
            loaded.forEach(({ id, data, body }, i) => {
                if (data.order === i + 1) return;
                atomicWrite(mdFile(type, id), stringifyMd({ ...data, order: i + 1 }, body));
            });
        } else {
            writeJsonEntries(type, arr => {
                ids.forEach((id, i) => { const e = arr.find(x => x.id === id); if (e) e.order = i + 1; });
                return arr.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
            });
        }
    }

    function writeSite(site) { need(); atomicWrite(path.join(V, 'site.json'), stableJson(site)); }
    function writeResumes(resumes) {
        need();
        // Publish needs a live résumé; an empty or all-draft list saved by
        // accident (e.g. from a page that loaded before the file existed)
        // would silently break the next publish.
        const parsed = resumesSchema.parse(resumes);
        if (!parsed.some(r => r.status === 'live')) {
            throw new Error('Invalid résumé list: keep at least one résumé live — the site’s résumé page needs one.');
        }
        atomicWrite(path.join(V, 'resumes.json'), stableJson(parsed));
    }

    // ── Media inventory ──
    function walk(dir, skip = () => false) {
        const out = [];
        for (const e of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
            const p = path.join(dir, e.name);
            if (skip(p, e)) continue;
            if (e.isDirectory()) out.push(...walk(p, skip)); else out.push(p);
        }
        return out;
    }

    /** All files in vault/media (not _originals) with the items that use them. */
    function mediaUsage() {
        const usedBy = new Map();
        const add = (r, type, id) => {
            if (!usedBy.has(r)) usedBy.set(r, []);
            const list = usedBy.get(r);
            if (!list.some(u => u.type === type && u.id === id)) list.push({ type, id });
        };
        for (const t of ITEM_TYPES) {
            for (const it of listRaw(t).items) {
                for (const r of mediaRefs(it.data, { includeHidden: true })) add(r, t, it.id);
                for (const a of it.data.attachments ?? []) { const r = mediaRel(a); if (r) add(r, t, it.id); }
            }
        }
        // `.part.mp4` is an ffmpeg transcode in progress (or left by a crash), not media
        const files = walk(mediaDir, (p, e) => (e.isDirectory() && e.name === '_originals') || /\.part\.mp4$|\.tmp$/.test(e.name));
        return files.map(f => {
            const r = path.relative(mediaDir, f).split(path.sep).join('/');
            return { rel: r, src: '/vault-media/' + r.split('/').map(encodeURIComponent).join('/'), bytes: fs.statSync(f).size, usedBy: usedBy.get(r) ?? [] };
        });
    }

    // ── Git (read-only status) ──
    const git = (cwd, args) => new Promise((resolve, reject) =>
        execFile('git', args, { cwd, maxBuffer: 1 << 24, windowsHide: true }, (err, stdout, stderr) =>
            err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout.trim())));

    /** One `git status -b --porcelain=v2` spawn gives branch, ahead count and changes together. */
    async function repoStatus(cwd) {
        if (!fs.existsSync(path.join(cwd, '.git'))) return null;
        const out = await git(cwd, ['status', '--porcelain=v2', '--branch']);
        let branch = 'HEAD', ahead = 0, changed = 0;
        for (const line of out.split(/\r?\n/)) {
            if (!line) continue;
            if (line.startsWith('# branch.head ')) { const h = line.slice(14); branch = h === '(detached)' ? 'HEAD' : h; }
            else if (line.startsWith('# branch.ab ')) ahead = Number(/\+(\d+)/.exec(line)?.[1] ?? 0);
            else if (!line.startsWith('#')) changed++;
        }
        return { branch, changed, ahead };
    }
    const gitStatus = async () => {
        const [site, vault] = await Promise.all([repoStatus(S), repoStatus(V)]);
        return { site, vault };
    };

    // ── Publish ──────────────────────────────────────────────────────────

    const OUT = {
        content: p => path.join(S, 'src/content', p),
        data: p => path.join(S, 'src/data', p),
        repo: p => path.join(S, p),
    };

    /** Decide what publish would write, without touching the site repo. */
    function planPublish() {
        need();
        const all = loadAll();
        const publicIds = new Set(all.collections.projects.filter(p => p.data.visibility === 'public').map(p => p.id));
        const ctx = makeCtx(publicIds);

        const outputs = {};      // type -> Map(id -> { title, text, file? })
        const items = [];        // per item decision, for the preview
        const media = new Map(); // repo-relative destination -> vault absolute source
        const videos = [];       // { src (as written), rel } for media-meta

        for (const type of PUBLISHABLE_TYPES) {
            outputs[type] = new Map();
            for (const it of all.collections[type]) {
                if (it.data.visibility !== 'public') continue;
                const body = isMd(type) ? publicBody(it.body) : '';
                const data = publicData(type, it.data);
                const errors = [...it.readiness.errors, ...schemaErrors(type, data)];
                const title = itemTitle(type, it.data);
                if (errors.length) { items.push({ type, id: it.id, title, publish: false, errors, warnings: it.readiness.warnings }); continue; }
                items.push({ type, id: it.id, title, publish: true, errors: [], warnings: it.readiness.warnings });
                outputs[type].set(it.id, {
                    title,
                    data: isMd(type) ? data : { id: it.id, ...data },
                    text: isMd(type) ? stringifyMd(data, body, { tidy: false }) : null,
                });
                for (const r of mediaRefs(it.data)) {
                    const from = path.join(mediaDir, ...r.split('/'));
                    if (!fs.existsSync(from)) continue; // optional default poster
                    media.set(publishedPath(r), from);
                }
                for (const m of normalizeMedia(it.data.media, { cover: it.data.image })) {
                    if (m.video && !m.hidden) videos.push({ src: m.src, rel: mediaRel(m.src), poster: mediaRel(posterSrcFor(m) ?? '') });
                }
            }
        }

        const live = all.resumes.filter(r => r.status === 'live');
        const resumeErrors = [];
        if (!live.length) resumeErrors.push('No live resume: mark one live in Resumes.');
        for (const r of live) if (!ctx.resumeExists(r.file)) resumeErrors.push(`${r.label}: ${r.file} not found.`);

        // A content file that does not parse is neither published nor safe to delete from the site
        const broken = all.broken.filter(b => /^(projects|experience|awards|courses|skills)[/.]/.test(b.file));
        return { all, outputs, items, media, videos, live, resumeErrors, broken };
    }

    function existingDest(type) {
        const found = new Map(), titles = new Map();
        if (isMd(type)) {
            const dir = OUT.content(type);
            for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
                if (!f.endsWith('.md')) continue;
                const text = fs.readFileSync(path.join(dir, f), 'utf8');
                found.set(f.slice(0, -3), text);
                try { titles.set(f.slice(0, -3), itemTitle(type, parseMd(text).data)); } catch { /* shown by id */ }
            }
        } else if (fs.existsSync(OUT.content(`${type}.json`))) {
            for (const e of readJsonFile(OUT.content(`${type}.json`))) { found.set(e.id, canonical(e)); titles.set(e.id, e.title ?? e.name ?? ''); }
        }
        return { found, titles };
    }

    /** Why a published item is about to disappear from the site. */
    function removalReason(plan, type, id) {
        const mdBroken = plan.broken.some(b => b.file === `${type}/${id}.md` || b.file === `${type}.json`);
        if (mdBroken) return 'broken';
        const it = plan.items.find(i => i.type === type && i.id === id);
        if (it && !it.publish) return 'errors';
        if (plan.all.collections[type]?.some(c => c.id === id)) return 'unpublished';
        return 'deleted';
    }

    /** Site copy, resume list and resume PDFs: what publish would change. */
    function previewSiteChanges(plan) {
        const out = [];
        const readJson = f => { try { return readJsonFile(f); } catch { return undefined; } };

        // Page copy (site.json): only when the vault has one, as publish does
        const vSite = path.join(V, 'site.json');
        if (fs.existsSync(vSite)) {
            const next = readJson(vSite), dest = OUT.data('site.json');
            const prev = fs.existsSync(dest) ? readJson(dest) : undefined;
            if (next !== undefined && (prev === undefined || canonical(prev) !== canonical(next))) {
                const keys = [...new Set([...Object.keys(next ?? {}), ...Object.keys(prev ?? {})])]
                    .filter(k => canonical(prev?.[k]) !== canonical(next?.[k]));
                out.push({
                    type: 'site', id: 'site', title: 'Page text', change: prev === undefined ? 'added' : 'updated',
                    ...(prev !== undefined && keys.length ? { summary: `Changed: ${keys.join(', ')}` } : {}),
                });
            }
        }

        // Resume list. Page images (`pages`) only change when a PDF is re-rendered, so compare the rest.
        const strip = e => ({ id: e.id, label: e.label, lens: e.lens, file: e.file });
        const nextEntries = plan.live.map(r => strip({ id: r.id, label: r.label, lens: r.lens, file: `/resume/${path.basename(path.resolve(V, r.file))}` }));
        const destList = OUT.data('resumes.json');
        const prevRaw = fs.existsSync(destList) ? readJson(destList) : undefined;
        const prevEntries = Array.isArray(prevRaw) ? prevRaw.map(strip) : [];
        if (!plan.resumeErrors.length || plan.live.length) {
            if (canonical(prevEntries) !== canonical(nextEntries) || (prevRaw === undefined && nextEntries.length)) {
                out.push({
                    type: 'resumes', id: 'resumes', title: 'Resume list', change: prevRaw === undefined ? 'added' : 'updated',
                    summary: `${nextEntries.length} live ${nextEntries.length === 1 ? 'resume' : 'resumes'}`,
                });
            }
        }

        // Resume PDFs
        const pubDir = path.join(S, 'public/resume');
        const keep = new Set();
        for (const r of plan.live) {
            const src = path.resolve(V, r.file);
            const name = path.basename(src);
            keep.add(name);
            if (!fs.existsSync(src)) continue;
            const dest = path.join(pubDir, name);
            const change = !fs.existsSync(dest) ? 'added' : sameFileContents(src, dest) ? null : 'updated';
            if (change) out.push({ type: 'resumes', id: `pdf:${name}`, title: `${r.label} PDF`, change, summary: name });
        }
        if (plan.live.length && fs.existsSync(pubDir)) {
            for (const f of fs.readdirSync(pubDir)) {
                if (/\.pdf$/i.test(f) && !keep.has(f)) out.push({ type: 'resumes', id: `pdf:${f}`, title: f, change: 'removed', summary: 'Resume PDF' });
            }
        }
        return out;
    }

    /** What publishing would change, per item. No writes. */
    function previewPublish(plan = planPublish()) {
        const changes = [];
        for (const type of PUBLISHABLE_TYPES) {
            const { found: before, titles } = existingDest(type);
            for (const [id, o] of plan.outputs[type]) {
                const now = isMd(type) ? o.text : canonical(o.data);
                if (!before.has(id)) changes.push({ type, id, title: o.title, change: 'added' });
                else if (before.get(id) !== now) changes.push({ type, id, title: o.title, change: 'updated' });
            }
            for (const id of before.keys()) {
                if (!plan.outputs[type].has(id)) changes.push({ type, id, title: titles.get(id) || id, change: 'removed', reason: removalReason(plan, type, id) });
            }
        }
        changes.push(...previewSiteChanges(plan));
        const skipped = plan.items.filter(i => !i.publish).map(({ type, id, title, errors }) => ({ type, id, title, errors }));
        const warnings = plan.items.filter(i => i.publish && i.warnings.length).map(({ type, id, title, warnings }) => ({ type, id, title, warnings }));
        const broken = plan.broken.map(({ file, error }) => ({ file, error }));
        return { changes, skipped, warnings, resumeErrors: plan.resumeErrors, broken };
    }

    function pruneDir(dir, keep) {
        const removed = [];
        (function visit(d) {
            if (!fs.existsSync(d)) return;
            for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                const p = path.join(d, e.name);
                if (e.isDirectory()) { visit(p); if (!fs.readdirSync(p).length) fs.rmdirSync(p); }
                else if (!keep.has(path.normalize(p))) { fs.rmSync(p); removed.push(p); }
            }
        })(dir);
        return removed;
    }

    /**
     * Write the public snapshot into the site repo and remove anything stale.
     * Async because it probes videos and prerenders resumes.
     * `onStep(name, detail)` reports progress; `prerender: false` skips resume rendering (tests).
     */
    async function publish({ onStep = () => {}, prerender = true } = {}) {
        const plan = planPublish();
        if (plan.resumeErrors.length) throw new Error(plan.resumeErrors.join(' '));
        if (plan.broken.length) {
            throw new Error(`Fix ${plan.broken.map(b => `${b.file} (${b.error})`).join('; ')} before publishing, or the site would lose ${plan.broken.length === 1 ? 'it' : 'them'}.`);
        }
        const written = [], removed = [], failed = [];
        const write = (file, text) => { if (writeIfChanged(file, text)) written.push(path.relative(S, file).split(path.sep).join('/')); };
        const preview = previewPublish(plan);

        // Content
        onStep('content', 'Writing projects, experience, awards');
        const counts = {};
        for (const type of PUBLISHABLE_TYPES) {
            const out = plan.outputs[type];
            counts[type] = out.size;
            if (isMd(type)) {
                const dir = OUT.content(type);
                fs.mkdirSync(dir, { recursive: true });
                for (const [id, o] of out) write(path.join(dir, `${id}.md`), o.text);
                const keep = new Set([...out.keys()].map(id => path.normalize(path.join(dir, `${id}.md`))));
                for (const f of fs.readdirSync(dir)) {
                    const p = path.join(dir, f);
                    if (f.endsWith('.md') && !keep.has(path.normalize(p))) { fs.rmSync(p); removed.push(path.relative(S, p).split(path.sep).join('/')); }
                }
            } else {
                const list = [...out.values()].map(o => o.data);
                write(OUT.content(`${type}.json`), stableJson(list));
            }
        }

        // Media: images into src/assets (optimized by the build), videos + posters into public
        onStep('media', `Copying ${plan.media.size} media files`);
        const keepMedia = new Set([...plan.media.keys()].map(r => path.normalize(path.join(S, r))));
        let mediaBytes = 0;
        for (const [dest, from] of plan.media) {
            const to = path.join(S, dest);
            mediaBytes += fs.statSync(from).size;
            if (fs.existsSync(to) && sameFileContents(from, to)) continue;
            fs.mkdirSync(path.dirname(to), { recursive: true });
            fs.copyFileSync(from, to);
            written.push(dest);
        }
        for (const base of ['src/assets/media', 'public/media']) {
            removed.push(...pruneDir(path.join(S, base), keepMedia).map(p => path.relative(S, p).split(path.sep).join('/')));
        }
        // Folders from before the vault pipeline
        for (const legacy of ['public/projects', 'public/vault-media']) {
            if (!fs.existsSync(OUT.repo(legacy))) continue;
            try { fs.rmSync(OUT.repo(legacy), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); removed.push(legacy + '/'); }
            catch (e) { failed.push(`${legacy}: ${e.code ?? e.message} (a dev server may be holding files; stop it and publish again)`); }
        }

        // Video facts for the pages (loop eligibility, intrinsic size)
        onStep('media-meta', 'Reading video details');
        const { probeVideo } = await import('./media.mjs');
        const meta = {};
        for (const v of plan.videos) {
            if (!v.rel || meta[v.src]) continue;
            try {
                const info = await probeVideo(path.join(mediaDir, ...v.rel.split('/')));
                meta[v.src] = { bytes: info.bytes, width: info.width, height: info.height, duration: info.duration == null ? null : Math.round(info.duration * 100) / 100 };
            } catch { /* ffprobe missing or unreadable: pages fall back to click-to-play */ }
        }
        write(OUT.data('media-meta.json'), stableJson(Object.fromEntries(Object.entries(meta).sort(([a], [b]) => a.localeCompare(b)))));

        // Site copy + resumes
        onStep('site', 'Writing site text');
        const siteFile = path.join(V, 'site.json');
        if (fs.existsSync(siteFile)) write(OUT.data('site.json'), stableJson(readJsonFile(siteFile)));

        onStep('resumes', 'Preparing resumes');
        const resumeInfo = await publishResumes(plan.live, { prerender, write, written });
        write(OUT.data('resumes.json'), stableJson(resumeInfo.entries));

        const keepResume = new Set(resumeInfo.keep.map(f => path.normalize(path.join(S, 'public/resume', f))));
        removed.push(...pruneDir(path.join(S, 'public/resume'), keepResume).map(p => path.relative(S, p).split(path.sep).join('/')));
        const keepLayers = new Set(resumeInfo.entries.map(e => path.normalize(OUT.data(`resume-layers/${e.id}.json`))));
        removed.push(...pruneDir(OUT.data('resume-layers'), keepLayers).map(p => path.relative(S, p).split(path.sep).join('/')));

        return {
            counts: { ...counts, media: plan.media.size, resumes: resumeInfo.entries.length },
            changes: preview.changes, skipped: preview.skipped, warnings: preview.warnings,
            written, removed, failed, mediaBytes, resumes: resumeInfo.report,
        };
    }

    /** Copy live PDFs to public/resume, render pages, write layer JSON. */
    async function publishResumes(live, { prerender, write, written }) {
        const outDir = path.join(S, 'public/resume');
        fs.mkdirSync(outDir, { recursive: true });
        const entries = [], keep = [], report = [];
        for (const r of live) {
            const src = path.resolve(V, r.file);
            const pdfName = path.basename(src);
            const dest = path.join(outDir, pdfName);
            write(dest, fs.readFileSync(src));
            keep.push(pdfName);

            const digest = sha1(fs.readFileSync(src));
            const layerFile = OUT.data(`resume-layers/${r.id}.json`);
            let layer = fs.existsSync(layerFile) ? readJsonFile(layerFile) : null;
            const cached = layer?.sha1 === digest && layer.pages.every(p => fs.existsSync(path.join(outDir, path.basename(p.src))));
            if (prerender && !cached) {
                const { renderPages, extractLayers } = await import('./resume-render.mjs');
                const rendered = await renderPages(src, r.id, outDir);
                for (const p of rendered.pages) written.push(`public/resume/${p.file}`);
                const text = await extractLayers(fs.readFileSync(src));
                layer = {
                    id: r.id, sha1: digest,
                    pages: rendered.pages.map((p, i) => ({ src: `/resume/${p.file}`, width: p.width, height: p.height, text: text[i]?.text ?? [], links: text[i]?.links ?? [] })),
                };
                write(layerFile, stableJson(layer));
                report.push({ id: r.id, pages: layer.pages.length, renderer: rendered.renderer, cached: false });
            } else if (layer) {
                report.push({ id: r.id, pages: layer.pages.length, renderer: 'cached', cached: true });
            }
            for (const p of layer?.pages ?? []) keep.push(path.basename(p.src));
            entries.push({
                id: r.id, label: r.label, ...(r.lens ? { lens: r.lens } : {}),
                file: `/resume/${pdfName}`,
                pages: (layer?.pages ?? []).map(p => ({ src: p.src, width: p.width, height: p.height })),
            });
        }
        return { entries, keep, report };
    }

    return {
        vaultDir: V, siteRoot: S, mediaDir,
        loadAll, listItems, getItem, saveItem, createItem, renameItem, deleteItem, restoreItem, listTrash, fileInbox, reorder,
        readSite, writeSite, readResumes, writeResumes, siteReadiness,
        mediaUsage, makeCtx, gitStatus, planPublish, previewPublish, publish,
    };
}

// ── Default instance (VAULT_DIR + this repo) ──────────────────────────────
const vault = createVault();

export const {
    loadAll, listItems, getItem, saveItem, createItem, renameItem, deleteItem, restoreItem, listTrash, fileInbox, reorder,
    readSite, writeSite, readResumes, writeResumes, siteReadiness,
    mediaUsage, makeCtx, gitStatus, planPublish, previewPublish, publish,
} = vault;

/** Back-compat name: all collections as plain item lists. */
export const listVault = () => Object.fromEntries(Object.entries(loadAll().collections));
