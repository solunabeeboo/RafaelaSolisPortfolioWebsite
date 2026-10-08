/**
 * Media references: normalization and path mapping.
 *
 * Items refer to media as `/vault-media/<path>` (the file lives at
 * vault/media/<path>). Publish copies images to src/assets/media/<path> (the
 * build optimizes them) and videos + posters to public/media/<path>.
 */

export const VAULT_MEDIA_PREFIX = '/vault-media/';

const VIDEO_RE = /\.(mp4|webm|ogg|mov|m4v)$/i;
const IMAGE_RE = /\.(webp|png|jpe?g|avif|gif|svg)$/i;
/** Formats the build can optimize. Anything else would not resolve via import.meta.glob. */
export const BUILD_IMAGE_RE = /\.(webp|png|jpe?g|avif)$/i;

export const isVideo = src => VIDEO_RE.test(String(src ?? '').split(/[?#]/)[0]);
export const isImage = src => IMAGE_RE.test(String(src ?? '').split(/[?#]/)[0]);
export const isRemote = src => /^https?:\/\//i.test(src ?? '');

/**
 * The ONE place media entries are interpreted. Accepts strings and objects
 * and returns objects with every field present.
 *
 *   normalizeMedia(['/vault-media/a.webp', { src, alt, caption, poster, hidden }])
 *   → [{ src, alt, caption, poster, hidden, video }]
 *
 * `opts.cover` (the project's `image`) is prepended when it is not already in
 * the list. Hidden entries are kept (the vault shows them dimmed);
 * `visibleMedia` drops them for public rendering.
 */
export function normalizeMedia(media, opts = {}) {
    const out = [];
    const add = entry => {
        const o = typeof entry === 'string' ? { src: entry } : entry;
        if (!o || typeof o.src !== 'string' || !o.src.trim()) return;
        out.push({
            src: o.src.trim(),
            alt: o.alt?.trim() ?? '',
            caption: o.caption?.trim() ?? '',
            poster: o.poster?.trim() || null,
            hidden: o.hidden === true,
            video: isVideo(o.src),
        });
    };
    for (const entry of media ?? []) add(entry);
    const cover = opts.cover?.trim();
    if (cover && !out.some(m => m.src === cover)) {
        const before = out.length;
        add(cover);
        if (out.length > before) out.unshift(out.pop());
    }
    return out;
}

export const visibleMedia = (media, opts) => normalizeMedia(media, opts).filter(m => !m.hidden);

/** `/vault-media/projects/x/a.webp` → `projects/x/a.webp`; null for anything else. */
export function mediaRel(src) {
    if (!src || !src.startsWith(VAULT_MEDIA_PREFIX)) return null;
    let rel;
    try { rel = decodeURIComponent(src.slice(VAULT_MEDIA_PREFIX.length).split(/[?#]/)[0]); }
    catch { return null; }
    // Reject traversal: media refs are always plain relative paths
    if (!rel || rel.split('/').some(seg => seg === '..' || seg === '') || /^[a-z]:/i.test(rel)) return null;
    return rel;
}

export const vaultMediaSrc = rel => VAULT_MEDIA_PREFIX + rel.split('/').map(encodeURIComponent).join('/');

/** Poster that sits beside a vault video: `a/b.mp4` → `a/b.poster.webp`. */
export const defaultPosterRel = videoRel => videoRel.replace(/\.[^./]+$/, '') + '.poster.webp';

/** The poster ref for a normalized video entry (explicit one wins). */
export function posterSrcFor(item) {
    if (item.poster) return item.poster;
    const rel = mediaRel(item.src);
    return rel ? vaultMediaSrc(defaultPosterRel(rel)) : null;
}

/** Where publish puts a media file in the site repo (relative to the repo root). */
export const publishedPath = rel => (isVideo(rel) || /\.poster\.[a-z]+$/i.test(rel) ? 'public/media/' : 'src/assets/media/') + rel;

/** Keys of `import.meta.glob('/src/assets/media/**')` for an image ref. */
export const imageGlobKey = src => {
    const rel = mediaRel(src);
    return rel ? '/src/assets/media/' + rel : null;
};

/** URL a published video or poster is served from. */
export const publicMediaUrl = src => {
    const rel = mediaRel(src);
    return rel ? '/media/' + rel.split('/').map(encodeURIComponent).join('/') : src;
};

/**
 * Every media ref an item uses, as vault-relative paths (cover, gallery,
 * explicit posters, default video posters). Hidden gallery entries are
 * excluded unless `includeHidden`.
 */
export function mediaRefs(data, { includeHidden = false } = {}) {
    const refs = new Set();
    const items = normalizeMedia(data.media, { cover: data.image })
        .filter(m => includeHidden || !m.hidden);
    for (const m of items) {
        for (const src of [m.src, m.video ? posterSrcFor(m) : null, m.poster]) {
            const rel = src && mediaRel(src);
            if (rel) refs.add(rel);
        }
    }
    return [...refs];
}
