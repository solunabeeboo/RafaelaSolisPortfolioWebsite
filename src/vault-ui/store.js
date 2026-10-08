// App state: server snapshot, optimistic edits with debounced autosave, undo, routing, toasts.
import { signal, computed, batch } from '@preact/signals';
import { api, itemUrl, connectEvents, handleJobEvent } from './api.js';
import { TYPES, KEEP_EMPTY, titleOf } from './meta.js';

export const PREVIEW_BASE = 'http://127.0.0.1:4321';
const SAVE_DELAY = 600;

// ---- Server snapshot ----

export const app = signal(null);          // { collections, site, resumes, git, broken, live, siteReadiness }
export const loadError = signal(null);
export const connected = signal(true);
export const publishInfo = signal(null);  // /api/publish/preview
export const saveStatus = signal({ state: 'saved', detail: '' });
export const conflicts = signal({});      // 'type/id' -> theirs item
export const publishSteps = signal([]);

export const collection = type => app.value?.collections?.[type] ?? [];
export const getItem = (type, id) => collection(type).find(i => i.id === id);

export async function loadState() {
    try {
        const s = await api.get('/api/state');
        batch(() => { app.value = s; loadError.value = null; });
        refreshPublish(0);
    } catch (e) {
        loadError.value = e.message;
    }
}

function replaceItem(type, id, fn) {
    const s = app.value;
    if (!s) return;
    const list = s.collections[type].map(i => (i.id === id ? fn(i) : i));
    app.value = { ...s, collections: { ...s.collections, [type]: list } };
}

function setCollection(type, list) {
    const s = app.value;
    app.value = { ...s, collections: { ...s.collections, [type]: list } };
}

// Merges a fresh snapshot without clobbering items that have unsaved local edits.
async function syncState() {
    let s;
    try { s = await api.get('/api/state'); } catch { return; }
    const cur = app.value;
    if (!cur) { app.value = s; return; }
    const nextConflicts = { ...conflicts.value };
    const collections = {};
    for (const [type, list] of Object.entries(s.collections)) {
        collections[type] = list.map(theirs => {
            const key = keyOf(type, theirs.id);
            const mine = cur.collections[type]?.find(i => i.id === theirs.id);
            if (!mine) return theirs;
            const busy = pending.get(key);
            if (busy?.inflight) return mine;
            if (busy?.dirty) {
                if (theirs.mtime !== mine.mtime) nextConflicts[key] = theirs;
                return { ...mine, readiness: theirs.readiness };
            }
            return theirs.mtime === mine.mtime ? { ...mine, readiness: theirs.readiness } : theirs;
        });
    }
    batch(() => {
        app.value = { ...s, collections, site: siteDirty ? cur.site : s.site };
        conflicts.value = nextConflicts;
    });
    refreshPublish();
}

let syncTimer;
const scheduleSync = () => { clearTimeout(syncTimer); syncTimer = setTimeout(syncState, 150); };

let publishTimer;
export function refreshPublish(delay = 1200) {
    clearTimeout(publishTimer);
    publishTimer = setTimeout(async () => {
        try { publishInfo.value = await api.get('/api/publish/preview'); } catch { /* shown when the panel opens */ }
    }, delay);
}

export function startEvents() {
    connectEvents((name, p) => {
        if (name === 'fs:changed') scheduleSync();
        else if (name.startsWith('job:')) handleJobEvent(name, p);
        else if (name === 'publish:step') publishSteps.value = [...publishSteps.value, p];
    }, ok => {
        const was = connected.value;
        connected.value = ok;
        if (ok && !was) syncState();
    });
}

// ---- Autosave ----

const pending = new Map(); // 'type/id' -> { timer, dirty, inflight, failures }
let showSavingTimer;
let savedAt = 0;

const keyOf = (type, id) => `${type}/${id}`;
const splitKey = key => { const i = key.indexOf('/'); return [key.slice(0, i), key.slice(i + 1)]; };

function setStatus(state, detail = '') { saveStatus.value = { state, detail }; }

function markDirty(type, id) {
    const key = keyOf(type, id);
    const e = pending.get(key) ?? {};
    e.dirty = true;
    clearTimeout(e.timer);
    e.timer = setTimeout(() => flush(type, id), SAVE_DELAY);
    pending.set(key, e);
}

export async function flush(type, id) {
    const key = keyOf(type, id);
    const e = pending.get(key);
    if (!e || !e.dirty || e.inflight) return;
    const item = getItem(type, id);
    if (!item) { pending.delete(key); return; }
    clearTimeout(e.timer);
    e.dirty = false;
    e.inflight = true;
    clearTimeout(showSavingTimer);
    showSavingTimer = setTimeout(() => setStatus('saving'), 700);
    try {
        const res = await api.put(itemUrl(type, id), { data: item.data, body: item.body, baseMtime: item.mtime });
        replaceItem(type, id, i => ({ ...i, mtime: res.item.mtime, readiness: res.item.readiness }));
        e.failures = 0;
        savedAt = Date.now();
        refreshPublish(300);
        bumpPreview();
    } catch (err) {
        e.dirty = true; // local edits stay until they are saved or she chooses
        if (err.status === 409 && err.body?.item) {
            conflicts.value = { ...conflicts.value, [key]: err.body.item };
        } else {
            e.failures = (e.failures || 0) + 1;
            setStatus('error', err.message);
            e.timer = setTimeout(() => flush(type, id), Math.min(2000 * e.failures, 15000));
        }
    } finally {
        e.inflight = false;
        clearTimeout(showSavingTimer);
        const blocked = conflicts.value[key];
        if (e.dirty && !e.failures && !blocked) {
            flush(type, id);
        } else {
            const failing = [...pending.values()].some(p => p.failures);
            if (!failing && !Object.keys(conflicts.value).length) setStatus('saved');
            else if (!failing) setStatus('error', 'Resolve the conflict to keep saving');
            if (!e.dirty) pending.delete(key);
        }
    }
}

export const lastSavedAt = () => savedAt;

export function flushAll() {
    for (const key of pending.keys()) flush(...splitKey(key));
    flushSite();
}

export const hasUnsaved = () => siteDirty || [...pending.values()].some(p => p.dirty || p.inflight);

export function retrySave() {
    for (const [key, e] of pending) { e.failures = 0; flush(...splitKey(key)); }
    if (siteDirty) flushSite();
}

export function resolveConflict(type, id, choice) {
    const key = keyOf(type, id);
    const theirs = conflicts.value[key];
    if (!theirs) return;
    const rest = { ...conflicts.value };
    delete rest[key];
    conflicts.value = rest;
    if (choice === 'theirs') {
        clearTimeout(pending.get(key)?.timer);
        pending.delete(key);
        replaceItem(type, id, () => theirs);
        setStatus('saved');
    } else {
        replaceItem(type, id, i => ({ ...i, mtime: theirs.mtime }));
        markDirty(type, id);
        flush(type, id);
    }
}

// ---- Editing with undo ----

const undoStack = [];
const redoStack = [];
const BODY = '$body';

function applyField(type, id, key, value) {
    replaceItem(type, id, i => {
        if (key === BODY) return { ...i, body: value ?? '' };
        const data = { ...i.data };
        if (value === undefined || (value === '' && !KEEP_EMPTY.has(key))) delete data[key];
        else data[key] = value;
        return { ...i, data };
    });
    markDirty(type, id);
}

function pushUndo(entry) {
    undoStack.push(entry);
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
}

/** Records a reversible action that is not a single-field edit (reorder, delete, rename, restore...). */
export function recordAction(label, undoFn, redoFn) {
    pushUndo({ label, fn: true, undo: undoFn, redo: redoFn, t: Date.now() });
}

function record(type, id, key, before, after) {
    const last = undoStack[undoStack.length - 1];
    const now = Date.now();
    if (last && !last.fn && last.type === type && last.id === id && last.key === key && now - last.t < 1200) {
        last.after = after;
        last.t = now;
        redoStack.length = 0;
    } else {
        pushUndo({ type, id, key, before, after, t: now });
    }
}

export function editData(type, id, key, value) {
    const item = getItem(type, id);
    if (!item) return;
    const before = item.data[key];
    if (JSON.stringify(before) === JSON.stringify(value)) return;
    record(type, id, key, before, value);
    applyField(type, id, key, value);
}

export function editBody(type, id, text) {
    const item = getItem(type, id);
    if (!item || item.body === text) return;
    record(type, id, BODY, item.body, text);
    applyField(type, id, BODY, text);
}

const FIELD_NAMES = { $body: 'case study text', hook: 'hook', media: 'media', image: 'cover', visibility: 'visibility', featured: 'featured', title: 'title', tags: 'tags', disciplines: 'disciplines' };
function describe(e) {
    const item = getItem(e.type, e.id);
    const what = e.key.startsWith('site:') ? 'site text ' + e.key.slice(5).replace(/\./g, ' ') : (FIELD_NAMES[e.key] ?? e.key);
    return `${what}${item ? ' on ' + titleOf(item) : ''}`;
}

async function step(from, to, dir) {
    const e = from.pop();
    if (!e) return false;
    const verb = dir === 'undo' ? 'Undid' : 'Redid';
    if (e.fn) {
        const f = dir === 'undo' ? e.undo : e.redo;
        if (!f) { toast(dir === 'undo' ? 'That can’t be undone' : 'That can’t be redone'); return true; }
        try { await f(); } catch (err) { toast(`Couldn’t ${dir}: ${err.message}`, { kind: 'error' }); return true; }
        to.push(e);
        toast(`${verb}: ${e.label}`, { timeout: 3000 });
        return true;
    }
    const value = dir === 'undo' ? e.before : e.after;
    if (e.key.startsWith('site:')) {
        editSite(e.key.slice(5), value, false);
    } else {
        if (!getItem(e.type, e.id)) return step(from, to, dir);
        applyField(e.type, e.id, e.key, value);
        const here = route.value;
        if (here.view !== e.type || here.id !== e.id) navigate(itemPath(e.type, e.id), { replace: true });
    }
    to.push(e);
    toast(`${verb}: ${describe(e)}`, { timeout: 3000 });
    return true;
}
export const undo = async () => { if (!(await step(undoStack, redoStack, 'undo'))) toast('Nothing to undo'); };
export const redo = async () => { if (!(await step(redoStack, undoStack, 'redo'))) toast('Nothing to redo'); };

// ---- Item lifecycle ----

export async function createItem(type, title, extra = {}) {
    const data = { [TYPES[type].titleKey]: title, ...(extra.data ?? {}) };
    if (TYPES[type].publishable && data.order === undefined) {
        // New work goes last so it can't jump to the top of the site the moment it is made public.
        data.order = collection(type).reduce((m, i) => Math.max(m, i.data.order ?? 0), 0) + 1;
    }
    const body = { title, data, ...(extra.body !== undefined ? { body: extra.body } : {}) };
    const { item } = await api.post(`/api/items/${type}`, body);
    setCollection(type, [...collection(type), item]);
    refreshPublish();
    if (type !== 'inbox') recordAction(`created ${titleOf(item)}`, () => deleteItem(type, item.id, { quiet: true, record: false }));
    return item;
}

export async function deleteItem(type, id, { quiet = false, record: rec = true } = {}) {
    const item = getItem(type, id);
    if (!item) return;
    const index = collection(type).findIndex(i => i.id === id);
    const key = keyOf(type, id);
    clearTimeout(pending.get(key)?.timer);
    pending.delete(key);
    setCollection(type, collection(type).filter(i => i.id !== id));
    try {
        const { trashId } = await api.del(itemUrl(type, id));
        let tid = trashId;
        let restoredId = id;
        const restore = async () => {
            const r = await api.post(`/api/trash/${encodeURIComponent(tid)}/restore`);
            restoredId = r.item.id;
            const list = collection(type).filter(i => i.id !== r.item.id);
            list.splice(Math.min(index, list.length), 0, r.item);
            setCollection(type, list);
            navigate(itemPath(type, r.item.id));
            refreshPublish();
        };
        let entry;
        if (rec) {
            recordAction(`deleted ${titleOf(item)}`, restore, async () => {
                const res = await api.del(itemUrl(type, restoredId));
                tid = res.trashId;
                setCollection(type, collection(type).filter(i => i.id !== restoredId));
                navigate(`/${type}`, { replace: true });
                refreshPublish();
            });
            entry = undoStack[undoStack.length - 1];
        }
        if (!quiet) {
            toast(`Deleted “${titleOf(item)}”. Ctrl+Z also brings it back.`, {
                label: 'Undo',
                action: async () => {
                    try {
                        await restore();
                        const i = undoStack.indexOf(entry);
                        if (i >= 0) undoStack.splice(i, 1);
                    } catch (e) { toast(`Couldn’t restore: ${e.message}`, { kind: 'error' }); }
                },
            });
        }
        refreshPublish();
    } catch (e) {
        const list = collection(type).slice();
        list.splice(Math.min(index, list.length), 0, item);
        setCollection(type, list);
        toast(`Couldn’t delete: ${e.message}`, { kind: 'error' });
    }
}

export async function renameItem(type, id, newId, { rec = true } = {}) {
    const { item } = await api.post(`${itemUrl(type, id)}/rename`, { newId });
    setCollection(type, collection(type).map(i => (i.id === id ? item : i)));
    if (rec) {
        const back = async (from, to) => {
            await renameItem(type, from, to, { rec: false });
            navigate(itemPath(type, to), { replace: true });
        };
        recordAction(`renamed ${id}`, () => back(item.id, id), () => back(id, item.id));
    }
    return item;
}

/** Puts an item's fields and text back to an earlier snapshot (used by History restore and its undo). */
export function setItemContent(type, id, data, body) {
    replaceItem(type, id, i => ({ ...i, data: structuredClone(data), body }));
    markDirty(type, id);
}

export async function fileInbox(id, toType) {
    flushAll();
    const { item } = await api.post(`${itemUrl('inbox', id)}/file`, { toType });
    setCollection('inbox', collection('inbox').filter(i => i.id !== id));
    setCollection(item.type, [...collection(item.type), item]);
    return item;
}

export async function reorder(type, ids, { rec = true } = {}) {
    const prev = sorted(type).map(i => i.id);
    if (prev.join() === ids.join()) return;
    const rank = new Map(ids.map((id, i) => [id, i + 1]));
    setCollection(type, collection(type).map(i => (rank.has(i.id) ? { ...i, data: { ...i.data, order: rank.get(i.id) } } : i)));
    try {
        await api.post(`/api/reorder/${type}`, { ids });
        if (rec) recordAction('the site order', () => reorder(type, prev, { rec: false }), () => reorder(type, ids, { rec: false }));
        scheduleSync();
        refreshPublish(300);
    } catch (e) {
        toast(`Couldn’t save the new order: ${e.message}`, { kind: 'error' });
        loadState();
    }
}

export const sorted = type =>
    collection(type).slice().sort((a, b) => (a.data.order ?? 999) - (b.data.order ?? 999) || titleOf(a).localeCompare(titleOf(b)));

// ---- Site text and résumés ----

let siteDirty = false;
let siteTimer;

export function editSite(path, value, rec = true) {
    if (rec) {
        const cur = path.split('.').reduce((o, k) => o?.[k], app.value.site);
        if (JSON.stringify(cur) === JSON.stringify(value)) return;
        record('site', 'site', 'site:' + path, cur, value);
    }
    const site = structuredClone(app.value.site);
    const parts = path.split('.');
    let o = site;
    for (const p of parts.slice(0, -1)) o = o[p] ??= {};
    const last = parts[parts.length - 1];
    if (value === '' || value === undefined) delete o[last]; else o[last] = value;
    app.value = { ...app.value, site };
    siteDirty = true;
    clearTimeout(siteTimer);
    siteTimer = setTimeout(flushSite, SAVE_DELAY);
}

async function flushSite() {
    if (!siteDirty) return;
    clearTimeout(siteTimer);
    siteDirty = false;
    setStatus('saving');
    try {
        const res = await api.put('/api/site', { site: app.value.site });
        const readiness = res?.readiness ?? res?.siteReadiness;
        if (readiness) app.value = { ...app.value, siteReadiness: readiness };
        setStatus('saved');
        refreshPublish(300);
        bumpPreview();
    } catch (e) {
        siteDirty = true;
        setStatus('error', e.message);
        siteTimer = setTimeout(flushSite, 4000);
    }
}

export async function saveResumes(resumes) {
    app.value = { ...app.value, resumes };
    try { await api.put('/api/resumes', { resumes }); refreshPublish(); }
    catch (e) { toast(`Couldn’t save résumés: ${e.message}`, { kind: 'error' }); }
}

// ---- Routing ----

export function parseRoute(path) {
    const parts = path.split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
    const [view = 'projects', id] = parts;
    return { view, id };
}

export const route = signal(parseRoute(location.pathname));
export const itemPath = (type, id) => `/${type}/${encodeURIComponent(id)}`;

export function navigate(path, { replace = false } = {}) {
    if (path === location.pathname) return;
    history[replace ? 'replaceState' : 'pushState'](null, '', path);
    route.value = parseRoute(path);
}
addEventListener('popstate', () => { route.value = parseRoute(location.pathname); });

// ---- UI flags ----

export const ui = {
    palette: signal(false),
    publish: signal(false),
    capture: signal(false),
    help: signal(false),
    history: signal(false),
    preview: signal(false),
    expanded: signal(false), // editor takes the full width
    focusField: signal(null),
    listOver: signal(false), // the item list slid over the editor while the preview is open
};

export const previewTick = signal(0);
let previewTimer;
function bumpPreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => { previewTick.value++; }, 400);
}

export const focusField = path => { ui.focusField.value = { path, n: Date.now() }; };

// ---- Toasts ----

export const toasts = signal([]);
let toastId = 0;

export function toast(message, { label, action, kind = 'info', timeout = 8000 } = {}) {
    const id = ++toastId;
    toasts.value = [...toasts.value, { id, message, label, action, kind }];
    setTimeout(() => dismissToast(id), kind === 'error' ? 12000 : timeout);
    return id;
}
export const dismissToast = id => { toasts.value = toasts.value.filter(t => t.id !== id); };

// ---- Derived ----

/** Items that need her eye: errors anywhere, or any warning on a public item. */
export const attention = computed(() => {
    const out = [];
    for (const type of ['projects', 'experience', 'awards', 'courses', 'skills']) {
        for (const item of collection(type)) {
            const { errors = [], warnings = [] } = item.readiness || {};
            if (errors.length || (item.data.visibility === 'public' && warnings.length)) out.push(item);
        }
    }
    return out;
});
export const inboxCount = computed(() => collection('inbox').length);

addEventListener('beforeunload', e => {
    if (hasUnsaved()) { flushAll(); e.preventDefault(); e.returnValue = ''; }
});
addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
