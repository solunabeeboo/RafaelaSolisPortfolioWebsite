/** A tiny job queue for slow work (ffmpeg, sharp). One job at a time; progress goes out over SSE. */
import crypto from 'node:crypto';

const KEEP_MS = 10 * 60_000;

export function createJobs(hub) {
    const jobs = new Map();
    let tail = Promise.resolve();

    const forget = id => setTimeout(() => jobs.delete(id), KEEP_MS).unref();

    return {
        get(id) { return jobs.get(id) ?? null; },

        /** Queued or running work, so the idle timer does not stop the server under it. */
        busy() { for (const j of jobs.values()) if (j.status === 'queued' || j.status === 'running') return true; return false; },

        /**
         * `work(report)` does the job; `report(pct, msg)` publishes progress.
         * Returns the job id immediately.
         */
        enqueue(work, meta = {}) {
            const id = crypto.randomBytes(6).toString('hex');
            // meta first: its `id` is the item's, and the job's own id must win (the item id stays in `itemId`)
            const job = { ...meta, itemId: meta.id, id, status: 'queued', pct: 0, msg: 'Waiting' };
            jobs.set(id, job);
            let lastPct = -1;
            const report = (pct, msg) => {
                pct = Math.max(0, Math.min(100, Math.round(pct)));
                Object.assign(job, { status: 'running', pct, msg });
                if (pct === lastPct && !msg) return;
                lastPct = pct;
                hub.send('job:progress', { jobId: id, pct, msg });
            };
            tail = tail.then(async () => {
                report(0, 'Starting');
                try {
                    const result = await work(report);
                    Object.assign(job, { status: 'done', pct: 100, result });
                    hub.send('job:done', { jobId: id, result });
                } catch (e) {
                    Object.assign(job, { status: 'error', error: String(e?.message ?? e) });
                    hub.send('job:error', { jobId: id, error: job.error });
                }
                forget(id);
            });
            return id;
        },
    };
}
