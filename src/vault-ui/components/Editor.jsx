// Item editor: every schema field for the item's type, with autosave handled by the store.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../icons.jsx';
import {
    getItem, collection, editData, editBody, conflicts, resolveConflict, deleteItem, renameItem, fileInbox,
    navigate, itemPath, ui, focusField, toast, flushAll, app,
} from '../store.js';
import { TYPES, DISCIPLINES, KINDS, KIND_LABELS, titleOf } from '../meta.js';
import { Field, TextInput, TextArea, Select, Switch, ChipToggles, TokenInput, ListEditor } from './fields.jsx';
import { MarkdownEditor } from './MarkdownEditor.jsx';
import { MediaGrid } from './MediaGrid.jsx';
import { Menu, Modal, EmptyState } from './ui.jsx';
import { api } from '../api.js';

const HOOK_MAX = 140;

function suggestionsFor(type, key) {
    const seen = new Set();
    for (const i of collection(type)) {
        const v = i.data[key];
        for (const s of Array.isArray(v) ? v : v ? [v] : []) if (typeof s === 'string' && s.trim()) seen.add(s.trim());
    }
    return [...seen].sort((a, b) => a.localeCompare(b));
}

function Datalist({ id, options }) {
    return <datalist id={id}>{options.map(o => <option value={o} />)}</datalist>;
}

function Section({ title, hint, children, aside, id }) {
    return (
        <section class="sec" data-field={id}>
            <div class="sec-head">
                <h2>{title}</h2>
                {aside}
            </div>
            {hint && <p class="hint sec-hint">{hint}</p>}
            {children}
        </section>
    );
}

function ReadinessPanel({ item }) {
    const { errors = [], warnings = [] } = item.readiness || {};
    const [open, setOpen] = useState(false);
    if (!errors.length && !warnings.length) {
        return <div class="ready ok"><Icon name="check" size={14} /> Ready{item.data.visibility === 'public' ? ' to publish' : ''}. Nothing needs attention.</div>;
    }
    const showWarnings = open || (!errors.length && warnings.length <= 3);
    const row = (kind, r) => (
        <li>
            <button type="button" class={'issue ' + kind} onClick={() => focusField(r.field)}>
                <Icon name="alert" size={14} />
                <span>{r.msg}</span>
                <Icon name="chevron" size={12} class="issue-go" />
            </button>
        </li>
    );
    return (
        <div class={'ready ' + (errors.length ? 'has-err' : 'has-warn')} role="region" aria-label="Readiness">
            <div class="ready-head">
                <strong>
                    {errors.length ? `${errors.length} to fix before this can be published` : 'Could be stronger'}
                </strong>
                {warnings.length > 0 && errors.length > 0 && (
                    <button type="button" class="link-btn" aria-expanded={showWarnings ? 'true' : 'false'} onClick={() => setOpen(o => !o)}>
                        {showWarnings ? 'Hide' : 'Show'} {warnings.length} {warnings.length === 1 ? 'suggestion' : 'suggestions'}
                    </button>
                )}
                {!errors.length && warnings.length > 3 && (
                    <button type="button" class="link-btn" aria-expanded={showWarnings ? 'true' : 'false'} onClick={() => setOpen(o => !o)}>
                        {showWarnings ? 'Hide' : `Show ${warnings.length}`}
                    </button>
                )}
            </div>
            <ul>
                {errors.map(r => row('err', r))}
                {showWarnings && warnings.map(r => row('warn', r))}
            </ul>
        </div>
    );
}

function ConflictBanner({ type, id }) {
    const theirs = conflicts.value[`${type}/${id}`];
    if (!theirs) return null;
    return (
        <div class="banner" role="alert">
            <Icon name="alert" size={16} />
            <span><strong>This file changed on disk</strong> while you were editing (another app, or a sync). Choose which version to keep.</span>
            <span class="banner-actions">
                <button type="button" class="btn" onClick={() => resolveConflict(type, id, 'theirs')}>Load theirs</button>
                <button type="button" class="btn primary" onClick={() => resolveConflict(type, id, 'mine')}>Keep mine</button>
            </span>
        </div>
    );
}

function RenameModal({ type, id, onClose }) {
    const [value, setValue] = useState(id);
    const [err, setErr] = useState('');
    const submit = async e => {
        e.preventDefault();
        const next = value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
        if (!next || next === id) return onClose();
        try {
            flushAll();
            await renameItem(type, id, next);
            navigate(itemPath(type, next), { replace: true });
            toast(`Renamed to ${next}`);
            onClose();
        } catch (e2) { setErr(e2.message); }
    };
    return (
        <Modal title="Rename URL slug" onClose={onClose} width={440}>
            <form onSubmit={submit} class="modal-body">
                <h2 class="modal-title">Rename URL slug</h2>
                <p class="hint">Changes the file name{type === 'projects' ? ' and the project’s web address' : ''}. Existing links to the old address stop working.</p>
                <Field label="Slug">{fid => <TextInput id={fid} value={value} onInput={setValue} data-autofocus spellcheck={false} />}</Field>
                {err && <p class="error-text" role="alert">{err}</p>}
                <div class="modal-actions">
                    <button type="button" class="btn" onClick={onClose}>Cancel</button>
                    <button type="submit" class="btn primary">Rename</button>
                </div>
            </form>
        </Modal>
    );
}

const emptyLink = () => ({ label: '', url: '' });

function ProjectFields({ item, set }) {
    const d = item.data;
    const isPublic = d.visibility === 'public';
    return (
        <>
            <Section title="Details">
                <div class="grid2">
                    <Field path="kind" label="Kind">{fid => <Select id={fid} value={d.kind} onChange={v => set('kind', v || undefined)} options={KINDS.map(k => ({ value: k, label: KIND_LABELS[k] }))} />}</Field>
                    <Field path="year" label="Year" hint="2025 or 2024–2025">{fid => <TextInput id={fid} value={d.year} onInput={v => set('year', v)} />}</Field>
                    <Field path="studio" label="Studio, class or jam">{fid => <><TextInput id={fid} list={`dl-studio`} value={d.studio} onInput={v => set('studio', v)} /><Datalist id="dl-studio" options={suggestionsFor('projects', 'studio')} /></>}</Field>
                    <Field path="role" label="Your role">{fid => <><TextInput id={fid} list="dl-role" value={d.role} onInput={v => set('role', v)} /><Datalist id="dl-role" options={suggestionsFor('projects', 'role')} /></>}</Field>
                    <Field path="team" label="Team">{fid => <TextInput id={fid} value={d.team} onInput={v => set('team', v)} />}</Field>
                    <Field path="engine" label="Engine and tools">{fid => <><TextInput id={fid} list="dl-engine" value={d.engine} onInput={v => set('engine', v)} /><Datalist id="dl-engine" options={suggestionsFor('projects', 'engine')} /></>}</Field>
                    <Field path="duration" label="Duration">{fid => <TextInput id={fid} value={d.duration} onInput={v => set('duration', v)} />}</Field>
                    <Field path="status" label="Status">{fid => <><TextInput id={fid} list="dl-status" value={d.status} onInput={v => set('status', v)} /><Datalist id="dl-status" options={suggestionsFor('projects', 'status')} /></>}</Field>
                </div>
                <Field path="platforms" label="Platforms">{fid => <TokenInput id={fid} value={d.platforms ?? []} onChange={v => set('platforms', v)} suggestions={['PC', 'Mac', 'Web', 'Android', 'iOS', 'Switch', ...suggestionsFor('projects', 'platforms')]} />}</Field>
                <Field path="tags" label="Tags" hint="Engines, languages, genres. Shown as plain text on the site.">{fid => <TokenInput id={fid} value={d.tags ?? []} onChange={v => set('tags', v)} suggestions={suggestionsFor('projects', 'tags')} />}</Field>
                <Field path="disciplines" label="Disciplines" hint="Which résumé lenses this fits. The first one you pick is its primary.">
                    <ChipToggles label="Disciplines" options={DISCIPLINES} value={d.disciplines ?? []} onChange={v => set('disciplines', v)} />
                </Field>
            </Section>

            <Section title="Media" id="media" hint={isPublic ? 'Public media needs alt text so screen readers can describe it.' : undefined}>
                <MediaGrid item={item} isPublic={isPublic} />
            </Section>

            <Section title="What I did" id="contribution" hint="Three to five bullets, each starting with a verb.">
                <ListEditor items={d.contribution ?? []} onChange={v => set('contribution', v)} makeItem={() => ''} addLabel="Add a bullet" itemLabel="bullet" onEnterAdd
                    renderRow={(v, i, update) => <TextArea value={v} rows={1} aria-label={`Bullet ${i + 1}`} onInput={update} />} />
            </Section>

            <Section title="Case study" id="body" hint="Your own words. Headings with ##, bullets with -.">
                <MarkdownEditor value={item.body} label="Case study" onInput={v => editBody(item.type, item.id, v)} id="body-text" />
            </Section>

            <details class="more-sections" data-field="structured" open={!!(d.problem || d.goal || d.result || d.reflection || d.iterations?.length)}>
                <summary><Icon name="chevron" size={14} /> Structured sections <span class="muted">(optional)</span></summary>
                <p class="hint">The site shows these above the written case study when filled in. Leave empty to hide.</p>
                <Field path="problem" label="Problem">{fid => <TextArea id={fid} rows={2} value={d.problem} onInput={v => set('problem', v)} />}</Field>
                <Field path="goal" label="Goal">{fid => <TextArea id={fid} rows={2} value={d.goal} onInput={v => set('goal', v)} />}</Field>
                <Field path="iterations" label="Iterations" hint="What you tried, what testing showed, what you changed.">
                    <ListEditor items={d.iterations ?? []} onChange={v => set('iterations', v)} makeItem={() => ({ before: '', finding: '', change: '' })} addLabel="Add an iteration" itemLabel="iteration"
                        renderRow={(it, i, update) => (
                            <div class="stack">
                                <TextArea value={it.before} rows={1} aria-label={`Iteration ${i + 1}: before`} placeholder="Before" onInput={v => update({ ...it, before: v })} />
                                <TextArea value={it.finding} rows={1} aria-label={`Iteration ${i + 1}: what testing showed`} placeholder="What testing showed" onInput={v => update({ ...it, finding: v })} />
                                <TextArea value={it.change} rows={1} aria-label={`Iteration ${i + 1}: change`} placeholder="What changed" onInput={v => update({ ...it, change: v })} />
                            </div>
                        )} />
                </Field>
                <Field path="result" label="Result">{fid => <TextArea id={fid} rows={2} value={d.result} onInput={v => set('result', v)} />}</Field>
                <Field path="reflection" label="Reflection">{fid => <TextArea id={fid} rows={2} value={d.reflection} onInput={v => set('reflection', v)} />}</Field>
            </details>

            <Section title="Links" id="links" hint="Play, source, article, store page.">
                <ListEditor items={d.links ?? []} onChange={v => set('links', v)} makeItem={emptyLink} addLabel="Add a link" itemLabel="link"
                    renderRow={(l, i, update) => (
                        <div class="pair">
                            <TextInput value={l.label} aria-label={`Link ${i + 1} label`} placeholder="Label, e.g. Play on itch.io" onInput={v => update({ ...l, label: v })} />
                            <TextInput value={l.url} aria-label={`Link ${i + 1} address`} placeholder="https://" spellcheck={false} onInput={v => update({ ...l, url: v })} />
                        </div>
                    )} />
                <Field path="embed" label="Playable embed" hint="Shown as a click-to-load player on the case study.">
                    <div class="pair pair-select">
                        <Select label="Embed type" value={d.embed?.type} placeholder="No embed" onChange={t => set('embed', t ? { type: t, url: d.embed?.url ?? '' } : undefined)}
                            options={[{ value: 'game', label: 'Game (itch.io)' }, { value: 'widget', label: 'Widget' }]} />
                        {d.embed && <TextInput value={d.embed.url} aria-label="Embed address" placeholder="https://" spellcheck={false} onInput={v => set('embed', { ...d.embed, url: v })} />}
                    </div>
                </Field>
            </Section>

            <Section title="Credits" id="credits" hint="Teammates and what they did.">
                <ListEditor items={d.credits ?? []} onChange={v => set('credits', v)} makeItem={() => ({ name: '', role: '' })} addLabel="Add a credit" itemLabel="credit"
                    renderRow={(c, i, update) => (
                        <div class="pair">
                            <TextInput value={c.name} aria-label={`Credit ${i + 1} name`} placeholder="Name" onInput={v => update({ ...c, name: v })} />
                            <TextInput value={c.role} aria-label={`Credit ${i + 1} role`} placeholder="Role" onInput={v => update({ ...c, role: v })} />
                        </div>
                    )} />
            </Section>
        </>
    );
}

function ExperienceFields({ item, set }) {
    const d = item.data;
    return (
        <>
            <Section title="Details">
                <div class="grid2">
                    <Field path="org" label="Organization">{fid => <TextInput id={fid} value={d.org} onInput={v => set('org', v)} />}</Field>
                    <Field path="location" label="Location">{fid => <TextInput id={fid} value={d.location} onInput={v => set('location', v)} />}</Field>
                    <Field path="start" label="Start">{fid => <TextInput id={fid} value={d.start} placeholder="Jan 2025" onInput={v => set('start', v)} />}</Field>
                    <Field path="end" label="End">{fid => <TextInput id={fid} value={d.end} placeholder="Present" onInput={v => set('end', v)} />}</Field>
                    <Field path="year" label="Year">{fid => <TextInput id={fid} value={d.year} onInput={v => set('year', v)} />}</Field>
                </div>
                <Field path="disciplines" label="Disciplines"><ChipToggles label="Disciplines" options={DISCIPLINES} value={d.disciplines ?? []} onChange={v => set('disciplines', v)} /></Field>
            </Section>
            <Section title="What I did" id="bullets" hint="Three to five bullets, each starting with a verb.">
                <ListEditor items={d.bullets ?? []} onChange={v => set('bullets', v)} makeItem={() => ''} addLabel="Add a bullet" itemLabel="bullet" onEnterAdd
                    renderRow={(v, i, update) => <TextArea value={v} rows={1} aria-label={`Bullet ${i + 1}`} onInput={update} />} />
            </Section>
            <BodySection item={item} placeholder="Longer description of the role (optional)." />
        </>
    );
}

function AwardFields({ item, set }) {
    const d = item.data;
    return (
        <>
            <Section title="Details">
                <div class="grid2">
                    <Field path="issuer" label="Issuer">{fid => <TextInput id={fid} value={d.issuer} onInput={v => set('issuer', v)} />}</Field>
                    <Field path="date" label="Date">{fid => <TextInput id={fid} value={d.date} placeholder="May 2026" onInput={v => set('date', v)} />}</Field>
                    <Field path="url" label="Link">{fid => <TextInput id={fid} value={d.url} placeholder="https://" spellcheck={false} onInput={v => set('url', v)} />}</Field>
                    <Field path="project" label="Related project">
                        {fid => <Select id={fid} value={d.project} onChange={v => set('project', v || undefined)} options={collection('projects').map(p => ({ value: p.id, label: titleOf(p) }))} placeholder="None" />}
                    </Field>
                </div>
                <Field path="disciplines" label="Disciplines"><ChipToggles label="Disciplines" options={DISCIPLINES} value={d.disciplines ?? []} onChange={v => set('disciplines', v)} /></Field>
            </Section>
            <BodySection item={item} title="Notes" placeholder="Anything worth remembering about this award." />
        </>
    );
}

function BodySection({ item, title = 'Description', placeholder }) {
    return (
        <Section title={title} id="body">
            <MarkdownEditor value={item.body} label={title} onInput={v => editBody(item.type, item.id, v)} id="body-text" placeholder={placeholder} />
        </Section>
    );
}

function CourseFields({ item, set }) {
    const d = item.data;
    return (
        <Section title="Details">
            <div class="grid2">
                <Field path="year" label="Year">{fid => <TextInput id={fid} value={d.year} onInput={v => set('year', v)} />}</Field>
            </div>
            <Field path="disciplines" label="Disciplines"><ChipToggles label="Disciplines" options={DISCIPLINES} value={d.disciplines ?? []} onChange={v => set('disciplines', v)} /></Field>
        </Section>
    );
}

function SkillFields({ item, set }) {
    const d = item.data;
    return (
        <Section title="Details">
            <Field path="items" label="Skills in this group">{fid => <TokenInput id={fid} value={d.items ?? []} onChange={v => set('items', v)} suggestions={suggestionsFor('skills', 'items')} />}</Field>
            <div class="grid2">
                <Field path="year" label="Year">{fid => <TextInput id={fid} value={d.year} onInput={v => set('year', v)} />}</Field>
            </div>
            <Switch checked={!!d.wide} onChange={v => set('wide', v)} label="Wide group" description="Spans both columns on the About page." />
            <Field path="disciplines" label="Disciplines"><ChipToggles label="Disciplines" options={DISCIPLINES} value={d.disciplines ?? []} onChange={v => set('disciplines', v)} /></Field>
        </Section>
    );
}

function NoteFields({ item, set }) {
    const d = item.data;
    return (
        <>
            <Section title="Details">
                <Field path="url" label="Link">{fid => <TextInput id={fid} value={d.url} placeholder="https://" spellcheck={false} onInput={v => set('url', v)} />}</Field>
                <Field path="tags" label="Tags">{fid => <TokenInput id={fid} value={d.tags ?? []} onChange={v => set('tags', v)} suggestions={suggestionsFor('notes', 'tags')} />}</Field>
            </Section>
            <BodySection item={item} title="Note" placeholder="Write the note." />
        </>
    );
}

function InboxFields({ item, set }) {
    const d = item.data;
    const file = async toType => {
        try {
            const filed = await fileInbox(item.id, toType);
            navigate(itemPath(filed.type, filed.id));
            toast(`Filed as ${TYPES[toType].one}. It is private until you make it public.`);
        } catch (e) { toast(`Couldn’t file it: ${e.message}`, { kind: 'error' }); }
    };
    return (
        <>
            <Section title="File this capture" hint="Captures stay private. Filing turns it into a draft you can finish.">
                <div class="file-actions">
                    <button type="button" class="btn primary" onClick={() => file('projects')}><Icon name="projects" size={15} /> File as project</button>
                    <button type="button" class="btn" onClick={() => file('awards')}><Icon name="awards" size={15} /> File as award</button>
                    <button type="button" class="btn" onClick={() => file('notes')}><Icon name="notes" size={15} /> File as note</button>
                </div>
            </Section>
            <Section title="Capture">
                <div class="grid2">
                    <Field path="kind" label="Looks like">{fid => <Select id={fid} value={d.kind} onChange={v => set('kind', v || undefined)} options={[{ value: 'project', label: 'A project' }, { value: 'award', label: 'An award' }, { value: 'note', label: 'A note' }]} placeholder="Not sure" />}</Field>
                    <Field path="url" label="Link">{fid => <TextInput id={fid} value={d.url} placeholder="https://" spellcheck={false} onInput={v => set('url', v)} />}</Field>
                </div>
                {(d.attachments?.length ?? 0) > 0 && (
                    <Field path="attachments" label="Attachments">
                        <ul class="attach">
                            {d.attachments.map(a => (
                                <li><Icon name="file" size={14} /> <a href={a} target="_blank" rel="noreferrer">{a.split('/').pop()}</a>
                                    <button type="button" class="icon-btn" aria-label={`Remove ${a.split('/').pop()}`} onClick={() => set('attachments', d.attachments.filter(x => x !== a))}><Icon name="x" size={14} /></button>
                                </li>
                            ))}
                        </ul>
                    </Field>
                )}
            </Section>
            <BodySection item={item} title="Notes" placeholder="The rest of what you wrote, plus anything you want to remember when filing it." />
        </>
    );
}

function NotesToSelf({ item, set }) {
    return (
        <Section title="Notes to self" id="todo" hint="Private to-dos. Never published.">
            <ListEditor items={item.data.todo ?? []} onChange={v => set('todo', v)} makeItem={() => ''} addLabel="Add a note" itemLabel="note" onEnterAdd
                renderRow={(v, i, update) => <TextArea value={v} rows={1} aria-label={`Note ${i + 1}`} onInput={update} />} />
        </Section>
    );
}

export function ItemEditor({ type, id }) {
    const item = getItem(type, id);
    const root = useRef(null);
    const [renaming, setRenaming] = useState(false);

    // Readiness issues ask to focus a field.
    const target = ui.focusField.value;
    useEffect(() => {
        if (!target || !root.current) return;
        const [base, idx] = target.path.split('.');
        const alias = { image: 'media' }[base] || base;
        let el = root.current.querySelector(`[data-field="${target.path}"]`);
        if (!el) {
            el = root.current.querySelector(`[data-field="${alias}"]`);
            const rowEl = idx !== undefined && el?.querySelectorAll('.list-row')[+idx];
            if (rowEl) el = rowEl;
        }
        if (!el) return;
        el.closest('details')?.setAttribute('open', '');
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        // Prefer a text box over a button, so Space or Enter can't flip a cover star or remove a tile.
        const focusable = el.querySelector('.tile-fields input:not([type=checkbox]),input:not([type=checkbox]):not(.visually-hidden),textarea,select')
            || el.querySelector('button');
        focusable?.focus({ preventScroll: true });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 1400);
    }, [target?.n]);

    if (!item) {
        return <EmptyState icon="alert" title="That item isn’t here">It may have been renamed or deleted.</EmptyState>;
    }

    const cfg = TYPES[type];
    const d = item.data;
    const set = (key, value) => editData(type, id, key, value);
    const publishable = cfg.publishable;
    const errors = item.readiness?.errors ?? [];
    const publicUrl = type === 'projects' ? `/projects/${id}/` : cfg.page;
    const title = titleOf(item);

    const doDelete = async () => {
        flushAll();
        const list = collection(type);
        const idx = list.findIndex(i => i.id === id);
        const next = list[idx + 1] ?? list[idx - 1];
        await deleteItem(type, id);
        navigate(next ? itemPath(type, next.id) : `/${type}`, { replace: true });
    };

    const Specific = { projects: ProjectFields, experience: ExperienceFields, awards: AwardFields, courses: CourseFields, skills: SkillFields, notes: NoteFields, inbox: InboxFields }[type];

    return (
        <div class="editor-col" ref={root}>
            <ConflictBanner type={type} id={id} />
            <header class="ed-head">
                <div class="ed-crumb">
                    <Icon name={cfg.icon} size={14} /> <a href={`/${type}`} onClick={e => { e.preventDefault(); navigate(`/${type}`); ui.expanded.value = false; }}>{cfg.label}</a>
                    <span aria-hidden="true">/</span> <code>{id}</code>
                </div>
                <div class="ed-tools">
                    {publishable && (
                        <button type="button" class={'btn ghost' + (ui.preview.value ? ' on' : '')} aria-pressed={ui.preview.value ? 'true' : 'false'}
                            title="Toggle live preview (Ctrl+\)" onClick={() => { ui.preview.value = !ui.preview.value; }}>
                            <Icon name="panel" size={15} /> Preview
                        </button>
                    )}
                    <button type="button" class="btn ghost" title="Version history" onClick={() => { ui.history.value = true; }}>
                        <Icon name="history" size={15} /> History
                    </button>
                    <Menu label="More actions" items={[
                        { label: 'Rename URL slug…', icon: 'link', run: () => setRenaming(true) },
                        publishable && { label: 'Copy public address', icon: 'external', run: () => { navigator.clipboard?.writeText(publicUrl); toast('Copied ' + publicUrl); } },
                        { label: 'Delete', icon: 'trash', danger: true, run: doDelete },
                    ]} />
                </div>
            </header>

            <div class="ed-title" data-field="title">
                {type === 'courses' || type === 'skills'
                    ? <TextInput value={d.name} class="title-input" aria-label="Name" placeholder="Name" onInput={v => set('name', v)} />
                    : <TextInput value={d.title} class="title-input" aria-label="Title" placeholder="Untitled" onInput={v => set('title', v)} />}
            </div>
            {type === 'projects' && (
                <div class="ed-hook" data-field="hook">
                    <TextArea value={d.hook} rows={1} class="hook-input" aria-label="Hook, one line that sells the project" placeholder="One line that sells the project" onInput={v => set('hook', v)} />
                    <span class={'count' + ((d.hook ?? '').length > HOOK_MAX ? ' over' : '')} aria-live="off">{(d.hook ?? '').length}/{HOOK_MAX}</span>
                </div>
            )}

            {publishable && (
                <div class="ed-switches">
                    <Switch checked={d.visibility === 'public'} onChange={v => set('visibility', v ? 'public' : 'private')}
                        label={d.visibility === 'public' ? 'Public' : 'Private'}
                        description={d.visibility === 'public'
                            ? (errors.length ? 'Won’t publish until the problems below are fixed' : 'Appears on the site when you publish')
                            : 'Only in the vault'} />
                    {type === 'projects' && <Switch checked={!!d.featured} onChange={v => set('featured', v)} label="Featured" description="Shown first on Home and Work" />}
                </div>
            )}

            {type !== 'inbox' && type !== 'notes' && <ReadinessPanel item={item} />}

            <Specific item={item} set={set} />

            {publishable && type !== 'courses' && type !== 'skills' && <NotesToSelf item={item} set={set} />}

            <footer class="ed-foot">
                <button type="button" class="btn danger-ghost" onClick={doDelete}><Icon name="trash" size={15} /> Delete {cfg.one}</button>
                <span class="muted">Deleted items can be restored from Trash.</span>
            </footer>
            {renaming && <RenameModal type={type} id={id} onClose={() => setRenaming(false)} />}
        </div>
    );
}
