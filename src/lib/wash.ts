import sharp from 'sharp';
import path from 'node:path';

/*
 * The projects page tints each strip/tab with its project image, heavily
 * blurred. Doing that blur live (CSS filter: blur on full-viewport fixed
 * backgrounds, ~4 layers per strip) re-rasterized every scroll frame and was
 * the page's main source of jank. Instead, blur once at build time: a tiny
 * pre-blurred image, inlined as a data URI. Stretched to the viewport it looks
 * the same as the old 18px blur at 14–32% opacity, for a fraction of the cost.
 */
const cache = new Map<string, Promise<string>>();

export function washFor(src: string | undefined): Promise<string> {
    if (!src || /\.(mp4|webm|ogg|gif)$/i.test(src)) return Promise.resolve('');
    let p = cache.get(src);
    if (!p) {
        p = sharp(path.join('public', decodeURI(src)))
            .resize(64, 40, { fit: 'cover' })
            .blur(1.2)
            .webp({ quality: 60 })
            .toBuffer()
            .then(buf => `url("data:image/webp;base64,${buf.toString('base64')}")`)
            .catch(() => '');
        cache.set(src, p);
    }
    return p;
}
