/** Small HTTP helpers: JSON bodies, errors, a pattern router, mime types. */
import path from 'node:path';

export class HttpError extends Error {
    constructor(status, error, detail, extra = {}) {
        super(detail ?? error);
        this.status = status;
        this.error = error;
        this.detail = detail;
        this.extra = extra;
    }
}

export function sendJson(res, status, body, headers = {}) {
    const text = JSON.stringify(body);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(text),
        'cache-control': 'no-store',
        ...headers,
    });
    res.end(text);
}

export async function readJson(req, limit = 8 * 1024 * 1024) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > limit) throw new HttpError(413, 'too-large', 'Request body is too large');
        chunks.push(chunk);
    }
    if (!size) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new HttpError(400, 'bad-json', 'Request body is not valid JSON'); }
}

/** Turn whatever vault-lib (or anything else) threw into an HTTP error. */
export function toHttpError(e) {
    if (e instanceof HttpError) return e;
    if (e?.name === 'StaleError') return new HttpError(409, 'stale', 'This item changed on disk since you opened it', { item: e.item });
    if (e?.code === 'ENOENT') return new HttpError(404, 'not-found', e.message);
    if (e?.name === 'ZodError') {
        return new HttpError(400, 'invalid', e.issues.map(i => `${i.path.join('.') || 'value'}: ${i.message}`).join('; '));
    }
    const msg = String(e?.message ?? e);
    if (/already exists/i.test(msg)) return new HttpError(409, 'conflict', msg);
    if (/^(Invalid|Unknown|Can't file|Give it a name|Item data|Frontmatter|Expected)/i.test(msg)) return new HttpError(400, 'invalid', msg);
    return new HttpError(500, 'server-error', msg);
}

export function createRouter() {
    const routes = [];
    return {
        add(method, pattern, handler) {
            const names = [];
            const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_m, n) => { names.push(n); return '([^/]+)'; }) + '$');
            routes.push({ method, re, names, handler });
        },
        match(method, pathname) {
            let pathMatched = false;
            for (const r of routes) {
                const m = r.re.exec(pathname);
                if (!m) continue;
                pathMatched = true;
                if (r.method !== method) continue;
                const params = {};
                r.names.forEach((n, i) => {
                    try { params[n] = decodeURIComponent(m[i + 1]); } catch { params[n] = m[i + 1]; }
                });
                return { handler: r.handler, params };
            }
            return { handler: null, pathMatched };
        },
    };
}

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
    '.gif': 'image/gif', '.ico': 'image/x-icon', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
    '.pdf': 'application/pdf', '.woff2': 'font/woff2', '.map': 'application/json', '.txt': 'text/plain; charset=utf-8',
};
export const mimeFor = file => MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
