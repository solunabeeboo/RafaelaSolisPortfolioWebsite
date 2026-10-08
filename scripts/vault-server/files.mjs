/** Serving files from disk: Range requests for video, ETag revalidation, traversal-safe lookup. */
import fs from 'node:fs';
import path from 'node:path';
import { HttpError, mimeFor } from './http.mjs';

/**
 * Resolve a URL sub-path inside `root`. Rejects anything that escapes it,
 * including through symlinks. Returns an absolute file path.
 */
export function resolveInside(root, urlPath) {
    let rel;
    try { rel = decodeURIComponent(urlPath); } catch { throw new HttpError(400, 'invalid', 'Bad path'); }
    if (rel.includes('\0') || rel.includes('\\')) throw new HttpError(400, 'invalid', 'Bad path');
    const base = fs.realpathSync(root);
    const file = path.resolve(base, rel.replace(/^\/+/, ''));
    if (file !== base && !file.startsWith(base + path.sep)) throw new HttpError(403, 'forbidden', 'Outside the media folder');
    let real;
    try { real = fs.realpathSync(file); } catch { throw new HttpError(404, 'not-found', 'No such file'); }
    if (real !== base && !real.startsWith(base + path.sep)) throw new HttpError(403, 'forbidden', 'Outside the media folder');
    if (!fs.statSync(real).isFile()) throw new HttpError(404, 'not-found', 'No such file');
    return real;
}

export function serveFile(req, res, file, { cacheControl = 'no-cache' } = {}) {
    const stat = fs.statSync(file);
    const etag = `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
    const headers = {
        'content-type': mimeFor(file), 'accept-ranges': 'bytes', etag,
        'last-modified': stat.mtime.toUTCString(), 'cache-control': cacheControl,
    };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }

    let start = 0, end = stat.size - 1, status = 200;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && (range[1] || range[2])) {
        if (range[1] === '') { start = Math.max(0, stat.size - Number(range[2])); }
        else { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
        if (start > end || start >= stat.size) {
            res.writeHead(416, { 'content-range': `bytes */${stat.size}` });
            return res.end();
        }
        status = 206;
        headers['content-range'] = `bytes ${start}-${end}/${stat.size}`;
    }
    headers['content-length'] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') return res.end();
    const stream = fs.createReadStream(file, { start, end });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
}
