// Thin client for the vault server: JSON requests, SSE events, streamed uploads.

export class ApiError extends Error {
    constructor(status, body) {
        super(body?.detail || body?.error || `Request failed (${status})`);
        this.status = status;
        this.body = body;
    }
}

async function request(method, url, body) {
    let res;
    try {
        res = await fetch(url, {
            method,
            credentials: 'same-origin',
            headers: body === undefined ? undefined : { 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
    } catch {
        throw new ApiError(0, { error: 'The vault server is not reachable' });
    }
    const text = await res.text();
    let json = null;
    if (text) { try { json = JSON.parse(text); } catch { json = { error: text.slice(0, 200) }; } }
    if (!res.ok) throw new ApiError(res.status, json);
    return json;
}

export const api = {
    get: url => request('GET', url),
    put: (url, body) => request('PUT', url, body),
    post: (url, body = {}) => request('POST', url, body),
    del: url => request('DELETE', url),
};

export const itemUrl = (type, id) => `/api/items/${type}/${encodeURIComponent(id)}`;

const EVENTS = ['fs:changed', 'job:progress', 'job:done', 'job:error', 'publish:step', 'checkpoint'];

/** Subscribes to server events. `onEvent(name, payload)`; `onStatus(connected)` tracks the link. */
export function connectEvents(onEvent, onStatus) {
    const es = new EventSource('/api/events');
    es.onopen = () => onStatus(true);
    es.onerror = () => onStatus(false);
    const parse = e => { try { return JSON.parse(e.data); } catch { return {}; } };
    for (const name of EVENTS) es.addEventListener(name, e => onEvent(name, parse(e)));
    // Servers that send unnamed messages carry the event name in the payload.
    es.onmessage = e => { const p = parse(e); if (p.event) onEvent(p.event, p.data ?? p); };
    return () => es.close();
}

const jobWaiters = new Map();
// A small job can finish before the upload response lands; keep its outcome briefly.
const earlyEvents = new Map();

export function handleJobEvent(name, p) {
    const w = jobWaiters.get(p.jobId);
    if (!w) {
        if (name !== 'job:progress') {
            earlyEvents.set(p.jobId, [name, p]);
            setTimeout(() => earlyEvents.delete(p.jobId), 30000);
        }
        return;
    }
    if (name === 'job:progress') w.onProgress?.(p.pct ?? 0, p.msg);
    if (name === 'job:done') { jobWaiters.delete(p.jobId); w.resolve(p.result ?? p); }
    if (name === 'job:error') { jobWaiters.delete(p.jobId); w.reject(new ApiError(500, { error: p.error || p.msg || 'Processing failed' })); }
}

/**
 * Uploads one file to an item. The body is the raw file; the server processes it as a
 * job and answers over SSE. Progress is reported 0-100 across both phases.
 */
export function upload(file, { type, id, onProgress = () => {} }) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/upload');
        xhr.setRequestHeader('x-type', type);
        xhr.setRequestHeader('x-id', id);
        xhr.setRequestHeader('x-filename', encodeURIComponent(file.name || 'pasted-image.png'));
        xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
        xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 40)); };
        xhr.onerror = () => reject(new ApiError(0, { error: 'Upload failed: the server is not reachable' }));
        xhr.onload = () => {
            let body = null;
            try { body = JSON.parse(xhr.responseText); } catch { /* handled below */ }
            if (xhr.status < 200 || xhr.status >= 300) return reject(new ApiError(xhr.status, body));
            if (!body?.jobId) return resolve(body);
            onProgress(40);
            jobWaiters.set(body.jobId, {
                resolve,
                reject,
                onProgress: pct => onProgress(40 + Math.round(pct * 0.6)),
            });
            const early = earlyEvents.get(body.jobId);
            if (early) { earlyEvents.delete(body.jobId); handleJobEvent(...early); }
        };
        xhr.send(file);
    });
}
