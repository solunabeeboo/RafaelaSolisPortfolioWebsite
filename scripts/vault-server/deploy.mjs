/** Latest GitHub Actions deploy run for main, through the `gh` CLI. Cached briefly; never throws. */
import { execFile } from 'node:child_process';

const TTL_MS = 30_000;

export function createDeployStatus(cwd) {
    let cached = null, at = 0;

    const query = () => new Promise(resolve => {
        const gh = process.env.VAULT_GH || 'gh';
        execFile(gh, ['run', 'list', '--workflow', 'deploy.yml', '--branch', 'main', '-L', '1', '--json', 'status,conclusion,createdAt,url'],
            { cwd, timeout: 10_000, windowsHide: true }, (err, stdout) => {
                if (err) return resolve({ available: false });
                try {
                    const [run] = JSON.parse(stdout);
                    resolve(run ? { available: true, ...run } : { available: true, none: true });
                } catch { resolve({ available: false }); }
            });
    });

    return {
        async get({ fresh = false } = {}) {
            if (!fresh && cached && Date.now() - at < TTL_MS) return cached;
            cached = await query();
            at = Date.now();
            return cached;
        },
        /** Call after a push so the next read isn't stale. */
        invalidate() { cached = null; },
    };
}
