/** Loopback-only guards: Host check, launch token cookie, exact Origin check. */
import crypto from 'node:crypto';
import { HttpError } from './http.mjs';

export const COOKIE = 'vault_t';

export function createSecurity({ port, requireToken }) {
    const token = requireToken ? crypto.randomBytes(24).toString('hex') : null;
    const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);

    const same = (a, b) => {
        const x = Buffer.from(String(a)), y = Buffer.from(String(b));
        return x.length === y.length && crypto.timingSafeEqual(x, y);
    };
    const cookieOf = req => {
        for (const part of String(req.headers.cookie ?? '').split(';')) {
            const [k, ...v] = part.trim().split('=');
            if (k === COOKIE) return v.join('=');
        }
        return null;
    };

    return {
        token,
        /** DNS-rebinding guard; applies to every request. */
        checkHost(req) {
            if (!hosts.has(String(req.headers.host ?? '').toLowerCase())) throw new HttpError(403, 'bad-host', 'Unexpected Host header');
        },
        /** Browsers always send Origin on cross-site writes; it must be this app exactly. */
        checkOrigin(req) {
            if (req.method === 'GET' || req.method === 'HEAD') return;
            const origin = req.headers.origin;
            if (origin !== undefined && !origins.has(origin)) throw new HttpError(403, 'bad-origin', 'Unexpected Origin');
        },
        isAuthed(req) {
            if (!requireToken) return true;
            const given = cookieOf(req) ?? req.headers['x-vault-token'];
            return typeof given === 'string' && same(given, token);
        },
        requireAuth(req) {
            if (!this.isAuthed(req)) throw new HttpError(401, 'unauthorized', 'Open Vault from its shortcut to sign in');
        },
        /** Set-Cookie value for a valid `?t=` launch link, else null. */
        cookieFor(candidate) {
            if (!requireToken || typeof candidate !== 'string' || !same(candidate, token)) return null;
            return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`;
        },
    };
}
