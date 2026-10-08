/** Command-line flags and paths for the vault server. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const num = (flag, v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) throw new Error(`${flag} needs a number`);
    return n;
};

/**
 * Flags:
 *   --port <n>            default 4319
 *   --no-astro            don't start the astro dev preview (tests)
 *   --no-token            skip the launch token (tests only; still loopback-bound)
 *   --astro-port <n>      preferred preview port, default 4321
 *   --idle-ms <n>         shut down after this long with no UI connected (default 15 min)
 *   --checkpoint-ms <n>   checkpoint commit this long after the last write (default 3 min)
 *   --site <dir>          site repo to publish into (env SITE_ROOT; default this repo)
 *   --state <dir>         working files: token, logs, ui bundle (env VAULT_STATE_DIR; default <site>/.vault)
 */
export function parseArgs(argv = process.argv.slice(2), env = process.env) {
    const o = {
        port: 4319, astro: true, token: true, astroPort: 4321,
        idleMs: 15 * 60_000, checkpointMs: 3 * 60_000,
        site: env.SITE_ROOT || REPO_ROOT, state: env.VAULT_STATE_DIR || null,
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => {
            if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
            return argv[++i];
        };
        switch (a) {
            case '--port': o.port = num(a, next()); break;
            case '--no-astro': o.astro = false; break;
            case '--no-token': o.token = false; break;
            case '--astro-port': o.astroPort = num(a, next()); break;
            case '--idle-ms': o.idleMs = num(a, next()); break;
            case '--checkpoint-ms': o.checkpointMs = num(a, next()); break;
            case '--site': o.site = next(); break;
            case '--state': o.state = next(); break;
            default: throw new Error(`Unknown option ${a}`);
        }
    }
    o.site = path.resolve(o.site);
    o.state = path.resolve(o.state || path.join(o.site, '.vault'));
    return o;
}
