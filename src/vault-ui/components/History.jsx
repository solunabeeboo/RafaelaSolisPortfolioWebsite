// Version history drawer: checkpoints for one item, a field-level comparison, and restore.
import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../icons.jsx';
import { api } from '../api.js';
import { getItem, ui, loadState, toast, flushAll, recordAction, setItemContent } from '../store.js';
import { Modal } from './ui.jsx';
import { ago } from '../meta.js';

const show = v => {
    if (v === undefined) return '(not set)';
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > 160 ? s.slice(0, 160) + '…' : s;
};

function diff(now, then) {
    const out = [];
    const keys = new Set([...Object.keys(now.data), ...Object.keys(then.data)]);
    for (const k of keys) {
        if (JSON.stringify(now.data[k]) !== JSON.stringify(then.data[k])) out.push({ key: k, now: now.data[k], then: then.data[k] });
    }
    for (const c of out) c.key = LABELS[c.key] ?? c.key;
    if ((now.body ?? '') !== (then.body ?? '')) {
        out.push({ key: 'Case study text', lines: lineDiff(then.body ?? '', now.body ?? '') });
    }
    return out;
}

const LABELS = {
    hook: 'Hook', title: 'Title', disciplines: 'Disciplines', media: 'Media', image: 'Cover image', logo: 'Logo', visibility: 'Visibility', featured: 'Featured',
    tags: 'Tags', platforms: 'Platforms', year: 'Year', studio: 'Studio', role: 'Role', engine: 'Engine', order: 'Site order', links: 'Links',
};

/** Small line diff: lines only in the old text are removed, lines only in the current text are added. */
function lineDiff(then, now) {
    const a = then.split('\n'), b = now.split('\n');
    const counts = new Map();
    for (const l of b) counts.set(l, (counts.get(l) ?? 0) + 1);
    const out = [];
    const seen = new Map();
    for (const l of a) { seen.set(l, (seen.get(l) ?? 0) + 1); }
    const bSet = new Map(counts);
    for (const l of a) {
        if (!l.trim()) continue;
        if ((bSet.get(l) ?? 0) > 0) bSet.set(l, bSet.get(l) - 1);
        else out.push({ t: 'then', l });
    }
    const aSet = new Map(seen);
    for (const l of b) {
        if (!l.trim()) continue;
        if ((aSet.get(l) ?? 0) > 0) aSet.set(l, aSet.get(l) - 1);
        else out.push({ t: 'now', l });
    }
    return out.slice(0, 60);
}

export function History({ type, id }) {
    const onClose = () => { ui.history.value = false; };
    const [list, setList] = useState(null);
    const [error, setError] = useState('');
    const [sel, setSel] = useState(null);
    const [version, setVersion] = useState(null);
    const item = getItem(type, id);

    const [busy, setBusy] = useState(false);

    useEffect(() => {
        flushAll();
        // A checkpoint of what is on disk right now, so there is always a version to come back to.
        setTimeout(() => api.post('/api/checkpoint').catch(() => {}).then(() =>
            api.get(`/api/history/${type}/${encodeURIComponent(id)}`)).then(setList, e => setError(e.message)), 700);
        api.get(`/api/history/${type}/${encodeURIComponent(id)}`).then(setList, e => setError(e.message));
    }, [type, id]);

    useEffect(() => {
        if (!sel) return;
        setVersion(null);
        api.get(`/api/history/${type}/${encodeURIComponent(id)}/${sel}`).then(setVersion, e => setError(e.message));
    }, [sel]);

    const restore = async () => {
        if (busy) return;
        setBusy(true);
        const before = item ? { data: structuredClone(item.data), body: item.body ?? '' } : null;
        try {
            await api.post(`/api/history/${type}/${encodeURIComponent(id)}/${sel}/restore`);
            await loadState();
            if (before) {
                const after = getItem(type, id);
                const restored = after ? { data: structuredClone(after.data), body: after.body ?? '' } : null;
                recordAction(`restored an earlier version of ${item.data.title || item.data.name || id}`,
                    () => setItemContent(type, id, before.data, before.body),
                    restored && (() => setItemContent(type, id, restored.data, restored.body)));
            }
            toast('Restored that version. Ctrl+Z puts back what you had.');
            onClose();
        } catch (e) { toast(`Couldn’t restore: ${e.message}`, { kind: 'error' }); setBusy(false); }
    };

    const changes = version && item ? diff(item, version) : [];

    return (
        <Modal title="Version history" onClose={onClose} width={720}>
            <div class="modal-body history">
                <div class="modal-head">
                    <h2 class="modal-title">Version history</h2>
                    <button type="button" class="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" size={16} /></button>
                </div>
                {error && <p class="error-text" role="alert">{error}</p>}
                {!list && !error && <p class="muted">Loading…</p>}
                {list && list.length === 0 && <p class="muted">No earlier versions yet. The vault saves a checkpoint a few minutes after you stop editing.</p>}
                {list && list.length > 0 && (
                    <div class="history-body">
                        <ul class="versions" role="listbox" aria-label="Versions">
                            {list.map(v => (
                                <li role="option" aria-selected={sel === v.hash ? 'true' : 'false'} tabindex="0" class={sel === v.hash ? 'on' : ''}
                                    onClick={() => setSel(v.hash)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSel(v.hash); } }}>
                                    <strong>{ago(new Date(v.date).getTime())}</strong>
                                    <span class="muted">{/^checkpoint/i.test(v.message) ? 'Automatic checkpoint' : v.message}</span>
                                </li>
                            ))}
                        </ul>
                        <div class="version-detail">
                            {!sel && <p class="muted">Pick a version to compare it with what you have now.</p>}
                            {sel && !version && <p class="muted">Loading…</p>}
                            {version && (
                                <>
                                    {changes.length === 0 ? <p>Same as the current version.</p> : (
                                        <ul class="changes">
                                            {changes.map(c => (
                                                <li>
                                                    <strong>{c.key}</strong>
                                                    {c.lines ? (
                                                        <div class="linediff">
                                                            {c.lines.map(x => <div class={x.t === 'then' ? 'was' : 'is'}><span class="muted">{x.t === 'then' ? 'Then' : 'Now'}</span> {x.l.length > 200 ? x.l.slice(0, 200) + '…' : x.l}</div>)}
                                                        </div>
                                                    ) : (<>
                                                        <div class="was"><span class="muted">Then</span> {show(c.then)}</div>
                                                        <div class="is"><span class="muted">Now</span> {show(c.now)}</div>
                                                    </>)}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                    {changes.length > 0 && (
                                        <div class="modal-actions">
                                            <button type="button" class="btn primary" onClick={restore} disabled={busy}>{busy ? 'Restoring…' : 'Restore this version'}</button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    );
}
