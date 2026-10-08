// Command palette (Ctrl+K): fuzzy search over every item plus actions. ">" limits to actions.
import { useState, useMemo, useRef, useEffect } from 'preact/hooks';
import { Icon } from '../icons.jsx';
import { ui, app, route, navigate, itemPath, undo, redo, editData, PREVIEW_BASE } from '../store.js';
import { TYPES, titleOf, fuzzy } from '../meta.js';
import { Modal } from './ui.jsx';

export const NAV = [
    ['Inbox', '/inbox', 'inbox', 'g i'],
    ['Needs attention', '/attention', 'alert', 'g a'],
    ['Projects', '/projects', 'projects', 'g p'],
    ['Experience', '/experience', 'experience', 'g e'],
    ['Awards', '/awards', 'awards', 'g w'],
    ['Courses', '/courses', 'courses', 'g c'],
    ['Skills', '/skills', 'skills', 'g k'],
    ['Résumés', '/resumes', 'resumes', 'g r'],
    ['Site text', '/site', 'site', 'g s'],
    ['Notes', '/notes', 'notes', 'g n'],
    ['Media', '/media', 'media', 'g m'],
    ['Trash', '/trash', 'trash', 'g t'],
];

function newIn(type) {
    navigate(`/${type}`);
    setTimeout(() => window.dispatchEvent(new Event('vault:new-item')), 60);
}

function currentItem() {
    const { view, id } = route.value;
    return TYPES[view] && id ? app.value?.collections?.[view]?.find(i => i.id === id) : null;
}

export function actions() {
    const cur = currentItem();
    const itemActions = cur ? [
        { label: `Open version history for ${titleOf(cur)}`, icon: 'history', run: () => { ui.history.value = true; } },
        ...(TYPES[cur.type].publishable ? [
            { label: `Make ${titleOf(cur)} ${cur.data.visibility === 'public' ? 'private' : 'public'}`, icon: 'globe', hint: 'Shift P', run: () => editData(cur.type, cur.id, 'visibility', cur.data.visibility === 'public' ? 'private' : 'public') },
        ] : []),
        ...(cur.type === 'projects' ? [
            { label: `${cur.data.featured ? 'Unfeature' : 'Feature'} ${titleOf(cur)}`, icon: 'star', run: () => editData(cur.type, cur.id, 'featured', !cur.data.featured) },
        ] : []),
    ] : [];
    return [
        ...itemActions,
        { label: 'New project', icon: 'plus', hint: 'N', run: () => newIn('projects') },
        { label: 'New experience', icon: 'plus', run: () => newIn('experience') },
        { label: 'New award', icon: 'plus', run: () => newIn('awards') },
        { label: 'Quick capture', icon: 'inbox', hint: 'C', run: () => { ui.capture.value = true; } },
        { label: 'Publish…', icon: 'publish', hint: 'Ctrl ↵', run: () => { ui.publish.value = true; } },
        { label: ui.preview.value ? 'Hide live preview' : 'Show live preview', icon: 'panel', hint: 'Ctrl \\', run: () => { ui.preview.value = !ui.preview.value; } },
        { label: 'Open the site preview in a browser', icon: 'external', run: () => window.open(PREVIEW_BASE, '_blank', 'noopener') },
        { label: 'Undo last change', icon: 'undo', hint: 'Ctrl Z', run: undo },
        { label: 'Redo', icon: 'undo', hint: 'Ctrl Shift Z', run: redo },
        { label: 'Keyboard shortcuts', icon: 'command', hint: '?', run: () => { ui.help.value = true; } },
        ...NAV.map(([label, path, icon, hint]) => ({ label: `Go to ${label}`, icon, hint, run: () => navigate(path) })),
    ];
}

export function Palette() {
    const onClose = () => { ui.palette.value = false; };
    const [query, setQuery] = useState('');
    const [hi, setHi] = useState(0);
    const listRef = useRef(null);

    const results = useMemo(() => {
        const q = query.startsWith('>') ? query.slice(1) : query;
        const actionsOnly = query.startsWith('>');
        const acts = actions().map(a => ({ ...a, kind: 'action', score: fuzzy(q, a.label) })).filter(a => a.score >= 0);
        let items = [];
        if (!actionsOnly) {
            const cols = app.value?.collections ?? {};
            for (const [type, list] of Object.entries(cols)) {
                for (const item of list) {
                    const d = item.data;
                    let s = Math.max(fuzzy(q, titleOf(item)), fuzzy(q, item.id) - 10, q.length > 1 ? fuzzy(q, [d.hook, d.studio, d.role, ...(d.tags ?? [])].filter(Boolean).join(' ')) - 30 : -1);
                    let snippet = '';
                    if (q.length > 2 && s < 0) {
                        // Case study text, alt text and captions: whole-word-ish substring only, ranked below titles.
                        const hay = [item.body, ...(d.media ?? []).map(m => (typeof m === 'string' ? '' : `${m.alt ?? ''} ${m.caption ?? ''}`))].filter(Boolean).join('\n');
                        const at = hay.toLowerCase().indexOf(q.toLowerCase().trim());
                        if (at >= 0) { s = 10; snippet = hay.slice(Math.max(0, at - 24), at + 60).replace(/\s+/g, ' ').trim(); }
                    }
                    if (s >= 0 && (q || type === 'projects')) items.push({ kind: 'item', type, item, label: titleOf(item), score: s, snippet });
                }
            }
            items.sort((a, b) => b.score - a.score);
        }
        acts.sort((a, b) => b.score - a.score);
        // Without a query, actions lead; with one, the better match leads.
        if (!q) return [...acts.slice(0, 6), ...items.slice(0, 8)];
        const top = [...items.slice(0, 20), ...acts.slice(0, 8)].sort((a, b) => b.score - a.score);
        return top.slice(0, 24);
    }, [query]);

    useEffect(() => { setHi(0); }, [query]);
    useEffect(() => { listRef.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }, [hi]);

    const run = r => {
        onClose();
        if (r.kind === 'item') navigate(itemPath(r.type, r.item.id));
        else setTimeout(r.run, 0);
    };

    const onKeyDown = e => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(results.length - 1, h + 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(0, h - 1)); }
        else if (e.key === 'Enter') { e.preventDefault(); results[hi] && run(results[hi]); }
    };

    return (
        <Modal title="Command palette" onClose={onClose} width={620} top>
            <div class="palette">
                <div class="palette-input">
                    <Icon name="search" size={16} />
                    <input data-autofocus type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list"
                        aria-activedescendant={results[hi] ? `pal-${hi}` : undefined} aria-label="Search items and actions"
                        placeholder="Search items, or type > for actions" value={query} autocomplete="off" spellcheck={false}
                        onInput={e => setQuery(e.currentTarget.value)} onKeyDown={onKeyDown} />
                </div>
                <ul id="palette-list" class="palette-list" role="listbox" aria-label="Results" ref={listRef}>
                    {results.map((r, i) => (
                        <li id={`pal-${i}`} role="option" aria-selected={i === hi ? 'true' : 'false'} class={i === hi ? 'on' : ''}
                            onMouseMove={() => setHi(i)} onClick={() => run(r)}>
                            <Icon name={r.kind === 'item' ? TYPES[r.type].icon : r.icon} size={15} />
                            <span class="pal-label">{r.label}</span>
                            {r.kind === 'item' && <>{r.snippet && <span class="muted pal-snippet">…{r.snippet}…</span>}<span class="muted pal-sub">{TYPES[r.type].one}{r.item.data.visibility === 'public' ? '' : r.item.data.visibility ? ' · private' : ''}</span></>}
                            {r.kind === 'action' && r.hint && <kbd>{r.hint}</kbd>}
                        </li>
                    ))}
                    {results.length === 0 && <li class="pal-empty" role="presentation">Nothing found for “{query}”.</li>}
                </ul>
            </div>
        </Modal>
    );
}
