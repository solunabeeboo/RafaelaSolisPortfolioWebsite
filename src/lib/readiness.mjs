/**
 * Readiness: what is wrong or thin about an item.
 *
 * Errors block `visibility: public` (publish skips the item and says why).
 * Warnings are advice only. Pure function of its inputs so the vault UI,
 * publish and tests all agree.
 *
 *   readiness(type, item, ctx) -> { errors: [{field,msg}], warnings: [{field,msg}] }
 *
 * `item` is the frontmatter data, plus `body` (string) when there is one.
 * `ctx` (all optional, a missing function skips that check):
 *   mediaExists(rel)   -> boolean       does vault/media/<rel> exist
 *   mediaBytes(rel)    -> number|null   its size
 *   resumeExists(file) -> boolean       does vault/<file> exist
 *   projectIds         -> Set<string>   slugs of existing projects (internal links)
 */
import { normalizeMedia, mediaRel, BUILD_IMAGE_RE } from './media.mjs';

export const HOOK_MAX = 140;
export const VIDEO_MAX_BYTES = 12 * 1024 * 1024;
const CONTRIBUTION_MIN = 3;

const blank = v => (typeof v !== 'string' && typeof v !== 'number') || !String(v).trim();

/** Absolute http(s)/mailto, or a site-internal path. */
export function isValidUrl(url) {
    if (typeof url !== 'string' || !url.trim()) return false;
    if (url.startsWith('/')) return !url.startsWith('//');
    try {
        const u = new URL(url);
        if (u.protocol === 'mailto:') return u.pathname.includes('@');
        return (u.protocol === 'http:' || u.protocol === 'https:') && (u.hostname.includes('.') || u.hostname === 'localhost');
    } catch { return false; }
}

const STATIC_ROUTES = new Set(['/', '/projects/', '/about/', '/contact/', '/resume/', '/article/']);

function internalRouteExists(url, ctx) {
    const path = url.split(/[?#]/)[0];
    const dir = path.endsWith('/') ? path : path + '/';
    if (STATIC_ROUTES.has(dir) || /^\/resume\/[a-z0-9-]+\/$/.test(dir)) return true;
    // Files served from public/ (PDFs, media)
    if (/^\/(media|resume)\//.test(path) && /\.[a-z0-9]+$/i.test(path)) return true;
    const m = dir.match(/^\/projects\/([^/]+)\/$/);
    if (m) return ctx.projectIds ? ctx.projectIds.has(m[1]) : true;
    return false;
}

function checkUrl(field, url, out, ctx) {
    if (!isValidUrl(url)) { out.errors.push({ field, msg: `"${url}" is not a valid link` }); return; }
    if (url.startsWith('/') && !internalRouteExists(url, ctx)) {
        out.warnings.push({ field, msg: `${url} doesn't match a page on this site` });
    }
}

function checkMedia(item, out, ctx) {
    const raw = item.media ?? [];
    const media = normalizeMedia(raw, { cover: item.image });
    const fieldFor = src => {
        const i = raw.findIndex(e => (typeof e === 'string' ? e : e?.src)?.trim() === src);
        return i >= 0 ? `media.${i}` : 'image';
    };
    for (const m of media) {
        const field = fieldFor(m.src);
        const name = m.src.split('/').pop();
        const check = (src, label) => {
            const rel = mediaRel(src);
            if (!rel) out.errors.push({ field, msg: `${label} ${src} is not in the vault (upload it)` });
            else if (ctx.mediaExists && !ctx.mediaExists(rel)) out.errors.push({ field, msg: `${label} ${src} was not found in the vault` });
        };
        check(m.src, m.video ? 'Video' : 'Image');
        if (!m.video && !BUILD_IMAGE_RE.test(m.src)) out.errors.push({ field, msg: `${name} is not a supported image (use WebP, PNG, JPG or AVIF, or upload it again)` });
        if (m.poster) check(m.poster, 'Poster');
        if (!m.hidden && !m.alt) out.warnings.push({ field, msg: `${name} has no alt text` });
        if (m.video && ctx.mediaBytes) {
            const rel = mediaRel(m.src);
            const bytes = rel ? ctx.mediaBytes(rel) : null;
            if (bytes && bytes > VIDEO_MAX_BYTES) {
                out.warnings.push({ field, msg: `${name} is ${(bytes / 1048576).toFixed(1)} MB (aim for under 12 MB)` });
            }
        }
    }
    return media;
}

const CHECKS = {
    projects(item, out, ctx) {
        if (blank(item.title)) out.errors.push({ field: 'title', msg: 'Needs a title' });
        if (blank(item.hook)) out.errors.push({ field: 'hook', msg: 'Needs a one-line hook' });
        for (const [i, l] of (item.links ?? []).entries()) checkUrl(`links.${i}`, l.url, out, ctx);
        if (item.embed) checkUrl('embed', item.embed.url, out, ctx);
        const media = checkMedia(item, out, ctx);
        if (!blank(item.logo)) {
            const rel = mediaRel(item.logo);
            if (!rel) out.errors.push({ field: 'logo', msg: `Logo ${item.logo} is not in the vault (upload it)` });
            else if (ctx.mediaExists && !ctx.mediaExists(rel)) out.errors.push({ field: 'logo', msg: `Logo ${item.logo} was not found in the vault` });
            if (!BUILD_IMAGE_RE.test(item.logo)) out.errors.push({ field: 'logo', msg: 'The logo must be an image (a transparent PNG or WebP works best)' });
        }

        const hasCover = !blank(item.image) || media.some(m => m.video && !m.hidden);
        if (item.featured && !hasCover) {
            out.warnings.push({ field: 'image', msg: 'Featured projects need a cover image or a video' });
        }
        if ((item.contribution?.length ?? 0) < CONTRIBUTION_MIN) {
            out.warnings.push({ field: 'contribution', msg: `Add ${CONTRIBUTION_MIN} or more bullets about what you did` });
        }
        if (blank(item.year)) out.warnings.push({ field: 'year', msg: 'No year set' });
        if (!item.links?.length && !item.embed) out.warnings.push({ field: 'links', msg: 'No links (play, source, article...)' });
        if (!blank(item.hook) && item.hook.trim().length > HOOK_MAX) {
            out.warnings.push({ field: 'hook', msg: `Hook is ${item.hook.trim().length} characters (aim for ${HOOK_MAX} or fewer)` });
        }
        if (/\bTODO\b/.test(item.body ?? '')) out.warnings.push({ field: 'body', msg: 'The text still contains TODO' });
    },
    experience(item, out) {
        if (blank(item.title)) out.errors.push({ field: 'title', msg: 'Needs a role title' });
        if (blank(item.org)) out.errors.push({ field: 'org', msg: 'Needs an organization' });
        if (blank(item.start)) out.errors.push({ field: 'start', msg: 'Needs a start date' });
        if ((item.bullets?.length ?? 0) < CONTRIBUTION_MIN) {
            out.warnings.push({ field: 'bullets', msg: `Add ${CONTRIBUTION_MIN} or more bullets` });
        }
    },
    awards(item, out, ctx) {
        if (blank(item.title)) out.errors.push({ field: 'title', msg: 'Needs a title' });
        if (item.url) checkUrl('url', item.url, out, ctx);
        if (blank(item.issuer)) out.warnings.push({ field: 'issuer', msg: 'No issuer set' });
        if (blank(item.date)) out.warnings.push({ field: 'date', msg: 'No date set' });
        if (item.project && ctx.projectIds && !ctx.projectIds.has(item.project)) {
            out.warnings.push({ field: 'project', msg: `Project "${item.project}" doesn't exist` });
        }
    },
    courses(item, out) {
        if (blank(item.name)) out.errors.push({ field: 'name', msg: 'Needs a name' });
    },
    skills(item, out) {
        if (blank(item.name)) out.errors.push({ field: 'name', msg: 'Needs a name' });
        if (!item.items?.length) out.warnings.push({ field: 'items', msg: 'No skills listed' });
    },
    notes(item, out) {
        if (blank(item.title)) out.errors.push({ field: 'title', msg: 'Needs a title' });
        if (item.url && !isValidUrl(item.url)) out.errors.push({ field: 'url', msg: `"${item.url}" is not a valid link` });
    },
    inbox() {},
    /** `item` = { site, resumes }. Missing site copy is hidden on the site, so those are warnings. */
    site({ site, resumes }, out, ctx) {
        if (blank(site?.home?.proof)) out.warnings.push({ field: 'home.proof', msg: 'No proof line on the home page (it stays hidden until you write one)' });
        if (blank(site?.home?.tagline)) out.warnings.push({ field: 'home.tagline', msg: 'No tagline' });
        if (!site?.about?.bio?.length) out.warnings.push({ field: 'about.bio', msg: 'No bio' });
        const live = (resumes ?? []).filter(r => r.status === 'live');
        if (!live.length) out.warnings.push({ field: 'resumes', msg: 'No live resume' });
        for (const r of live) {
            if (ctx.resumeExists && !ctx.resumeExists(r.file)) out.errors.push({ field: 'resumes', msg: `${r.label}: ${r.file} was not found` });
        }
    },
};

export function readiness(type, item, ctx = {}) {
    const out = { errors: [], warnings: [] };
    CHECKS[type]?.(item ?? {}, out, ctx);
    return out;
}

/** Only errors block publishing. */
export const isPublishable = r => r.errors.length === 0;
