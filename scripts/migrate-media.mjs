#!/usr/bin/env node
/**
 * One-time migration from the old layout to the vault media pipeline.
 *
 *   node scripts/migrate-media.mjs [--dry-run] [--vault <dir>] [--site <repo root>]
 *
 * - /projects/images/* and /projects/screenshots/* references become
 *   /vault-media/projects/<slug>/<file> (slug-safe names), with the files moved
 *   into vault/media/projects/<slug>/. Large videos are transcoded; the originals
 *   are kept under vault/media/_originals/ (gitignored in the vault).
 * - Every projects/experience file is rewritten once as block-style YAML
 *   (bodies are untouched).
 * - site.json and the resume list move into the vault; the old resume that
 *   stopped deploying goes to resumes/archive/.
 *
 * The site repo is only ever READ. Safe to run repeatedly: a second run finds
 * nothing left to do. Legacy files missing from the working tree are read from
 * git HEAD.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ROOT, VAULT_DIR, parseMd, stringifyMd, slugify, atomicWrite } from './vault-lib.mjs';
import { isVideo } from '../src/lib/media.mjs';
import { processVideo } from './media.mjs';

const LEGACY_PREFIXES = ['/projects/images/', '/projects/screenshots/'];
const isLegacy = ref => typeof ref === 'string' && LEGACY_PREFIXES.some(p => ref.startsWith(p));

/** `bender (1).webp` -> `bender-1.webp`; videos always end up `.mp4`. */
export function safeFileName(original) {
    const ext = path.extname(original).toLowerCase();
    const stem = path.basename(original, path.extname(original)).replace(/\((\d+)\)/g, '-$1');
    return (slugify(stem) || 'file') + (isVideo(original) ? '.mp4' : ext);
}

function legacyReader(siteRoot) {
    const fromGit = rel => {
        try {
            return execFileSync('git', ['show', `HEAD:${rel}`], { cwd: siteRoot, maxBuffer: 1 << 29, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
        } catch { return null; }
    };
    return {
        /** File bytes from the working tree, else git HEAD, else null. */
        read(rel) {
            const p = path.join(siteRoot, rel);
            return fs.existsSync(p) ? fs.readFileSync(p) : fromGit(rel);
        },
        /** Repo-relative file paths under a folder, from the working tree or git HEAD. */
        list(dirRel) {
            const dir = path.join(siteRoot, dirRel);
            if (fs.existsSync(dir)) {
                const out = [];
                (function walk(d) {
                    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
                        const p = path.join(d, e.name);
                        if (e.isDirectory()) walk(p); else out.push(path.relative(siteRoot, p).split(path.sep).join('/'));
                    }
                })(dir);
                return out;
            }
            try {
                return execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD', dirRel], { cwd: siteRoot, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
                    .toString().split('\n').filter(Boolean);
            } catch { return []; }
        },
    };
}

export async function migrate({ vaultDir = VAULT_DIR, siteRoot = ROOT, dryRun = false, log = () => {} } = {}) {
    const V = path.resolve(vaultDir);
    if (!fs.existsSync(V)) throw new Error(`Vault not found at ${V}`);
    const legacy = legacyReader(path.resolve(siteRoot));
    const report = {
        dryRun, media: [], missing: [], videos: [], unusedKept: [], rewritten: [], resumes: [], site: null, gitignore: false,
    };
    const do_ = fn => { if (!dryRun) fn(); };
    const vaultPath = (...p) => path.join(V, ...p);

    // ── Projects: move media, rewrite refs ──
    const used = new Set(); // legacy repo paths that projects reference
    for (const type of ['projects', 'experience']) {
        const dir = vaultPath(type);
        for (const f of fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.md')).sort() : []) {
            const file = path.join(dir, f);
            const text = fs.readFileSync(file, 'utf8');
            const { data, body } = parseMd(text);
            const slug = f.slice(0, -3);
            const names = new Map(); // legacy ref -> new vault ref
            const taken = new Set();

            const moveRef = async ref => {
                if (!isLegacy(ref)) return ref;
                if (names.has(ref)) return names.get(ref);
                const rel = 'public' + decodeURIComponent(ref);
                used.add(rel);
                let name = safeFileName(path.basename(rel));
                for (let n = 2; taken.has(name); n++) name = name.replace(/(-\d+)?(\.[^.]+)$/, `-${n}$2`);
                taken.add(name);
                const newRef = `/vault-media/projects/${slug}/${name}`;
                const bytes = legacy.read(rel);
                if (!bytes) { report.missing.push({ project: slug, ref }); return ref; }
                const dest = vaultPath('media', 'projects', slug, name);
                const entry = { project: slug, from: ref, to: newRef, bytes: bytes.length };
                if (isVideo(rel)) {
                    entry.transcode = true;
                    if (!fs.existsSync(dest)) {
                        log(`  ${dryRun ? "would transcode" : "transcoding"} ${path.basename(rel)} (${(bytes.length / 1048576).toFixed(1)} MB)`);
                        if (!dryRun) {
                            const original = vaultPath('media', '_originals', 'projects', slug, path.basename(rel));
                            fs.mkdirSync(path.dirname(original), { recursive: true });
                            fs.writeFileSync(original, bytes);
                            let last = -10;
                            const r = await processVideo(original, dest, {
                                onProgress: pct => { if (pct - last >= 25) { last = pct; log(`    ${pct}%`); } },
                            });
                            entry.newBytes = r.bytes;
                            entry.duration = r.duration;
                            report.videos.push({ name: `${slug}/${name}`, from: bytes.length, to: r.bytes, duration: r.duration });
                        } else {
                            report.videos.push({ name: `${slug}/${name}`, from: bytes.length, to: null, duration: null });
                        }
                    }
                } else if (!fs.existsSync(dest)) {
                    do_(() => { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, bytes); });
                }
                report.media.push(entry);
                names.set(ref, newRef);
                return newRef;
            };

            if (type === 'projects') {
                if (typeof data.image === 'string') data.image = await moveRef(data.image);
                if (Array.isArray(data.media)) {
                    for (const [i, m] of data.media.entries()) {
                        if (typeof m === 'string') data.media[i] = await moveRef(m);
                        else if (m?.src) m.src = await moveRef(m.src);
                    }
                }
            }
            const next = stringifyMd(data, body, { tidy: false });
            if (next !== text) {
                report.rewritten.push(`${type}/${f}`);
                do_(() => atomicWrite(file, next));
            }
        }
    }

    // Legacy files nobody references: keep them in the vault rather than losing them.
    // Skipped on re-runs (the refs are gone by then, so every file would look unused).
    const alreadyMigrated = fs.existsSync(vaultPath('_migration-report.json'));
    const migratedNames = new Set(
        fs.existsSync(vaultPath('media/projects'))
            ? fs.readdirSync(vaultPath('media/projects')).flatMap(d => fs.readdirSync(vaultPath('media/projects', d)))
            : []);
    for (const rel of alreadyMigrated ? [] : legacy.list('public/projects')) {
        if (used.has(rel) || migratedNames.has(safeFileName(path.basename(rel)))) continue;
        const dest = vaultPath('media', 'unused-from-site', 'projects', rel.slice('public/projects/'.length));
        if (fs.existsSync(dest)) continue;
        const bytes = legacy.read(rel);
        if (!bytes) continue;
        report.unusedKept.push(rel);
        do_(() => { fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, bytes); });
    }

    // ── site.json ──
    if (!fs.existsSync(vaultPath('site.json'))) {
        const site = legacy.read('src/data/site.json');
        report.site = site ? 'moved into vault/site.json' : 'no site.json found to move';
        if (site) do_(() => atomicWrite(vaultPath('site.json'), site));
    } else report.site = 'already in vault';

    // ── resumes.json ──
    if (!fs.existsSync(vaultPath('resumes.json'))) {
        const old = legacy.read('src/data/resumes.json');
        if (old) {
            const entries = JSON.parse(old.toString()).resumes ?? [];
            const out = [];
            for (const e of entries) {
                const name = path.basename(e.file);
                const live = e.enabled !== false;
                const relFile = live ? `resumes/${name}` : `resumes/archive/${name}`;
                if (!fs.existsSync(vaultPath(relFile))) {
                    const pdf = legacy.read('public' + e.file);
                    if (pdf) do_(() => { fs.mkdirSync(path.dirname(vaultPath(relFile)), { recursive: true }); fs.writeFileSync(vaultPath(relFile), pdf); });
                    else report.missing.push({ resume: e.id, ref: e.file });
                }
                out.push({ id: e.id, label: e.label, ...(e.discipline ? { lens: e.discipline } : {}), file: relFile, status: live ? 'live' : 'draft' });
                report.resumes.push(`${e.id}: ${live ? 'live' : 'draft'} -> ${relFile}`);
            }
            do_(() => atomicWrite(vaultPath('resumes.json'), JSON.stringify(out, null, 2) + '\n'));
        }
    }

    // ── Vault .gitignore: originals stay local ──
    const ignoreFile = vaultPath('.gitignore');
    const ignore = fs.existsSync(ignoreFile) ? fs.readFileSync(ignoreFile, 'utf8') : '';
    const ignoreWanted = ['media/_originals/', '*.part.mp4', '*.tmp'];
    const ignoreMissing = ignoreWanted.filter(l => !ignore.split(/\r?\n/).some(x => x.trim() === l || x.trim() === l.replace(/\/$/, '')));
    if (ignoreMissing.length) {
        report.gitignore = true;
        do_(() => atomicWrite(ignoreFile, (ignore && !ignore.endsWith('\n') ? ignore + '\n' : ignore) + ignoreMissing.join('\n') + '\n'));
    }

    if (!dryRun) {
        const doneSomething = report.media.length || report.rewritten.length || report.unusedKept.length || report.resumes.length || report.gitignore;
        if (doneSomething) atomicWrite(vaultPath('_migration-report.json'), JSON.stringify(report, null, 2) + '\n');
    }
    return report;
}

export function formatReport(r) {
    const mb = n => (n / 1048576).toFixed(1) + ' MB';
    const lines = [`Media migration${r.dryRun ? ' (dry run, nothing written)' : ''}`];
    lines.push(`  media files moved:   ${r.media.length}`);
    for (const m of r.media) lines.push(`    ${m.from}  ->  ${m.to}${m.transcode ? '  [video]' : ''}`);
    if (r.videos.length) {
        lines.push('  videos:');
        for (const v of r.videos) lines.push(`    ${v.name}: ${mb(v.from)}${v.to != null ? ` -> ${mb(v.to)} (${v.duration?.toFixed(1)} s)` : ' (would transcode)'}`);
    }
    lines.push(`  unreferenced files kept: ${r.unusedKept.length}`);
    for (const f of r.unusedKept) lines.push(`    ${f}`);
    lines.push(`  frontmatter rewritten as block YAML: ${r.rewritten.length}`);
    lines.push(`  site.json: ${r.site}`);
    lines.push(`  resumes: ${r.resumes.length ? '' : 'nothing to do'}`);
    for (const x of r.resumes) lines.push(`    ${x}`);
    if (r.gitignore) lines.push('  vault .gitignore: add media/_originals/');
    if (r.missing.length) {
        lines.push(`  MISSING sources (refs left unchanged): ${r.missing.length}`);
        for (const m of r.missing) lines.push(`    ${m.project ?? m.resume}: ${m.ref}`);
    }
    return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const args = process.argv.slice(2);
    const flag = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
    try {
        const report = await migrate({
            dryRun: args.includes('--dry-run'),
            vaultDir: flag('--vault') ?? VAULT_DIR,
            siteRoot: flag('--site') ?? ROOT,
            log: m => console.log(m),
        });
        console.log(formatReport(report));
    } catch (e) {
        console.error(e.message);
        process.exit(1);
    }
}
