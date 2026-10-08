// Item list for one type: filter, sort, keyboard navigation, drag to reorder, inline "new".
import { useState, useRef, useEffect, useMemo } from 'preact/hooks';
import { signal } from '@preact/signals';
import { Icon, StarFilled } from '../icons.jsx';
import {
    sorted, route, navigate, itemPath, createItem, reorder, editData, ui, toast,
} from '../store.js';
import { TYPES, titleOf, DISCIPLINES, ago } from '../meta.js';
import { ReadyBadge, EmptyState } from './ui.jsx';

// Filter text survives switching between types, which feels right when hunting for something.
export const listQuery = signal('');
const FILTERS = {
    all: { label: 'All', test: () => true },
    public: { label: 'Public', test: i => i.data.visibility === 'public' },
    private: { label: 'Private', test: i => i.data.visibility !== 'public' },
    featured: { label: 'Featured', test: i => !!i.data.featured },
    issues: { label: 'Issues', test: i => (i.readiness?.errors?.length ?? 0) + (i.readiness?.warnings?.length ?? 0) > 0 },
};
const DISC = Object.fromEntries(DISCIPLINES.map(d => [d.id, d.label]));

function searchText(item) {
    const d = item.data;
    return [titleOf(item), item.id, d.hook, d.studio, d.role, d.org, d.issuer, d.engine, d.year, ...(d.tags ?? []), ...(d.items ?? [])].filter(Boolean).join(' ').toLowerCase();
}

export function Library({ type }) {
    const cfg = TYPES[type];
    const [filter, setFilter] = useState('all');
    const [sort, setSort] = useState(type === 'inbox' ? 'updated' : 'order');
    const [adding, setAdding] = useState(false);
    const [drag, setDrag] = useState(null); // { from, over, after }
    const listRef = useRef(null);
    const searchRef = useRef(null);
    const q = listQuery.value.trim().toLowerCase();

    const all = sorted(type);
    const items = useMemo(() => {
        let list = all.filter(FILTERS[filter].test);
        if (q) list = list.filter(i => q.split(/\s+/).every(w => searchText(i).includes(w)));
        if (sort === 'title') list = list.slice().sort((a, b) => titleOf(a).localeCompare(titleOf(b)));
        if (sort === 'year') list = list.slice().sort((a, b) => (b.data.year ?? '').localeCompare(a.data.year ?? ''));
        if (sort === 'updated') list = list.slice().sort((a, b) => b.mtime - a.mtime);
        return list;
    }, [all, filter, sort, q]);

    const selectedId = route.value.id;
    const reorderable = cfg.publishable !== undefined && type !== 'inbox';
    const canReorder = reorderable && sort === 'order';
    const idx = items.findIndex(i => i.id === selectedId);

    // Keep the selected row in view as the selection moves.
    useEffect(() => {
        listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
    }, [selectedId, items.length]);

    // The "/" key and palette actions ask the filter box to take focus.
    useEffect(() => {
        const focus = () => searchRef.current?.focus();
        window.addEventListener('vault:focus-search', focus);
        const add = () => setAdding(true);
        window.addEventListener('vault:new-item', add);
        return () => { window.removeEventListener('vault:focus-search', focus); window.removeEventListener('vault:new-item', add); };
    }, []);

    const startNew = () => { if (type === 'inbox') ui.capture.value = true; else setAdding(true); };
    const open = i => { ui.listOver.value = false; navigate(itemPath(type, i.id), { replace: true }); };

    // Reordering inside a filter swaps positions among the visible rows only; hidden rows keep their slots.
    const reorderVisible = nextVisible => {
        const full = all.map(i => i.id);
        const slots = items.map(i => full.indexOf(i.id)).sort((a, b) => a - b);
        const out = full.slice();
        nextVisible.forEach((id, k) => { out[slots[k]] = id; });
        reorder(type, out);
    };

    const onKeyDown = e => {
        if (e.target !== e.currentTarget) return;
        const move = d => {
            e.preventDefault();
            const next = items[Math.min(items.length - 1, Math.max(0, (idx < 0 ? (d > 0 ? -1 : items.length) : idx) + d))];
            if (next) open(next);
        };
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            if (!reorderable) return;
            if (!canReorder) { toast('Sort by “Site order” to reorder'); return; }
            if (idx < 0) return;
            const ids = items.map(i => i.id);
            const to = idx + (e.key === 'ArrowUp' ? -1 : 1);
            if (to < 0 || to >= ids.length) return;
            [ids[idx], ids[to]] = [ids[to], ids[idx]];
            reorderVisible(ids);
        } else if (e.key === 'ArrowDown' || e.key === 'j') move(1);
        else if (e.key === 'ArrowUp' || e.key === 'k') move(-1);
        else if (e.key === 'Home') { e.preventDefault(); items[0] && open(items[0]); }
        else if (e.key === 'End') { e.preventDefault(); items.at(-1) && open(items.at(-1)); }
        else if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); ui.expanded.value = true; setTimeout(() => document.querySelector('.title-input')?.focus(), 0); }
        else if (e.key === 'P' && e.shiftKey && cfg.publishable && idx >= 0) {
            e.preventDefault();
            const it = items[idx];
            editData(type, it.id, 'visibility', it.data.visibility === 'public' ? 'private' : 'public');
        }
    };

    const startDrag = (e, i) => {
        if (!canReorder) { e.preventDefault(); return; }
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', items[i].id);
        setDrag({ from: i, over: i, after: false });
    };
    const overDrag = (e, i) => {
        if (!drag) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        setDrag({ ...drag, over: i, after: e.clientY > r.top + r.height / 2 });
    };
    const drop = e => {
        e.preventDefault();
        if (!drag) return;
        const ids = items.map(i => i.id);
        const [moved] = ids.splice(drag.from, 1);
        let at = drag.over + (drag.after ? 1 : 0);
        if (drag.from < at) at--;
        ids.splice(Math.max(0, at), 0, moved);
        setDrag(null);
        if (ids.join() !== items.map(i => i.id).join()) reorderVisible(ids);
    };

    return (
        <section class="library" aria-label={cfg.label}>
            <div class="lib-head">
                <h2>{cfg.label} <span class="count-chip">{all.length}</span></h2>
                <button type="button" class="btn small primary" onClick={startNew} title={type === 'inbox' ? 'Capture (C)' : 'New (N)'}><Icon name="plus" size={14} /> {type === 'inbox' ? 'Capture' : 'New'}</button>
            </div>
            <div class="lib-searchrow">
            <div class="lib-search">
                <Icon name="search" size={14} />
                <input ref={searchRef} type="search" aria-label={`Filter ${cfg.label.toLowerCase()}`} placeholder={`Filter ${cfg.label.toLowerCase()}`} value={listQuery.value}
                    onInput={e => { listQuery.value = e.currentTarget.value; }}
                    onKeyDown={e => {
                        if (e.key === 'Escape') { listQuery.value = ''; e.currentTarget.blur(); listRef.current?.focus(); }
                        if (e.key === 'ArrowDown' || e.key === 'Enter') { e.preventDefault(); if (items[0] && idx < 0) open(items[0]); listRef.current?.focus(); }
                    }} />
                {!q && <kbd class="hint-kbd">/</kbd>}
            </div>
            <select class="select-quiet" value={sort} onChange={e => setSort(e.currentTarget.value)} aria-label="Sort by">
                <option value="order">Site order</option>
                <option value="title">Title</option>
                {(type === 'projects' || type === 'experience') && <option value="year">Year</option>}
                <option value="updated">Recent</option>
            </select>
            </div>
            {type !== 'inbox' && type !== 'notes' && (
                <div class="lib-filters">
                    <div class="segmented" role="group" aria-label="Show">
                        {Object.entries(FILTERS).filter(([k]) => cfg.publishable ? (k !== 'featured' || type === 'projects') : false).map(([k, f]) => (
                            <button type="button" aria-pressed={filter === k ? 'true' : 'false'} onClick={() => setFilter(k)}>{f.label}</button>
                        ))}
                    </div>

                </div>
            )}

            {adding && <NewRow type={type} onDone={() => setAdding(false)} />}

            {items.length === 0 && !adding ? (
                <EmptyState icon={cfg.icon} title={q || filter !== 'all' ? 'Nothing matches' : type === 'inbox' ? 'Inbox is empty' : `No ${cfg.label.toLowerCase()} yet`}
                    action={!q && filter === 'all' ? <button type="button" class="btn primary" onClick={startNew}>{type === 'inbox' ? 'Capture something' : `New ${cfg.one}`}</button> : null}>
                    {q || filter !== 'all' ? 'Try a different search or filter.' : type === 'inbox' ? 'Inbox zero. Press C to capture something, or paste a screenshot anywhere.' : undefined}
                </EmptyState>
            ) : (
                <ul class="rows" role="listbox" aria-label={cfg.label} tabindex="0" ref={listRef} onKeyDown={onKeyDown}
                    aria-activedescendant={selectedId ? `row-${type}-${selectedId}` : undefined}
                    onDragOver={e => drag && e.preventDefault()} onDrop={drop}>
                    {items.map((item, i) => {
                        const d = item.data;
                        const selected = item.id === selectedId;
                        const isPublic = d.visibility === 'public';
                        const dropClass = drag && drag.over === i && drag.from !== i ? (drag.after ? ' drop-after' : ' drop-before') : '';
                        return (
                            <li id={`row-${type}-${item.id}`} role="option" aria-selected={selected ? 'true' : 'false'}
                                class={'row' + (selected ? ' selected' : '') + (drag?.from === i ? ' dragging' : '') + dropClass}
                                draggable={canReorder} onDragStart={e => startDrag(e, i)} onDragOver={e => overDrag(e, i)} onDragEnd={() => setDrag(null)}
                                onClick={() => { open(item); }} onDblClick={() => { ui.expanded.value = true; }}>
                                {cfg.publishable ? (
                                    <span class={'vis ' + (isPublic ? 'pub' : 'priv')} title={isPublic ? 'Public' : 'Private'}>
                                        {isPublic ? <span class="dot" /> : <Icon name="lock" size={12} />}
                                        <span class="visually-hidden">{isPublic ? 'Public. ' : 'Private. '}</span>
                                    </span>
                                ) : <span class="vis"><Icon name={cfg.icon} size={13} /></span>}
                                <span class="row-title">{titleOf(item)}</span>
                                {d.featured && <span class="star" title="Featured"><StarFilled size={12} /><span class="visually-hidden">Featured. </span></span>}
                                <ReadyBadge readiness={item.readiness} publicOnly={!isPublic && cfg.publishable} />
                                <span class="row-meta">
                                    {type === 'inbox' ? ago(item.mtime)
                                        : type === 'notes' ? ''
                                        : type === 'awards' ? (d.date ?? '')
                                        : type === 'skills' ? `${d.items?.length ?? 0}`
                                        : (d.year ?? '')}
                                </span>
                                {type === 'projects' && <span class="row-disc">{DISC[d.disciplines?.[0]] ?? ''}</span>}
                            </li>
                        );
                    })}
                </ul>
            )}
            {canReorder && items.length > 1 && <p class="lib-foot">Drag to reorder, or Alt+Up / Alt+Down. This is the order on the site.{filter !== 'all' || q ? ' With a filter on, only the rows you can see change places.' : ''}</p>}
        </section>
    );
}

function NewRow({ type, onDone }) {
    const cfg = TYPES[type];
    const [title, setTitle] = useState('');
    const [busy, setBusy] = useState(false);
    const submit = async e => {
        e.preventDefault();
        const t = title.trim();
        if (!t || busy) return;
        setBusy(true);
        try {
            const item = await createItem(type, t);
            navigate(itemPath(type, item.id));
            onDone();
            // Put the cursor where she writes next: the hook for projects, the title otherwise.
            const sel = type === 'projects' ? '.hook-input' : '.title-input';
            let tries = 0;
            const grab = () => {
                const el = document.querySelector(sel);
                if (el && document.querySelector('.editor-col')) { el.focus(); return; }
                if (++tries < 40) requestAnimationFrame(grab);
            };
            requestAnimationFrame(grab);
        } catch (err) {
            toast(`Couldn’t create it: ${err.message}`, { kind: 'error' });
            setBusy(false);
        }
    };
    return (
        <form class="newrow" onSubmit={submit}>
            <input type="text" data-autofocus ref={el => el && !el.dataset.f && (el.dataset.f = 1, el.focus())}
                aria-label={`Title of the new ${cfg.one}`} placeholder={`Title of the new ${cfg.one}, then Enter`} value={title}
                onInput={e => setTitle(e.currentTarget.value)} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onDone(); } }} />
            <button type="submit" class="btn small primary" disabled={!title.trim() || busy}>Create</button>
            <button type="button" class="btn small" onClick={onDone}>Cancel</button>
        </form>
    );
}
