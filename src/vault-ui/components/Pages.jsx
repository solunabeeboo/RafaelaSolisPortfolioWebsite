// Non-list views: needs attention, résumés, site text, media library, trash.
import { useEffect, useState } from 'preact/hooks';
import { Icon } from '../icons.jsx';
import { api } from '../api.js';
import {
    app, attention, navigate, itemPath, route, editSite, saveResumes, toast, loadState, focusField, ui,
} from '../store.js';
import { TYPES, titleOf, isVideo, posterFor, fmtBytes, ago } from '../meta.js';
import { Field, TextInput, TextArea, Select, Switch, ListEditor } from './fields.jsx';
import { EmptyState, ReadyBadge } from './ui.jsx';

function PageShell({ title, count, children, lead }) {
    return (
        <section class="page" aria-label={title}>
            <div class="page-col">
                <h1>{title}{count !== undefined && <span class="count-chip">{count}</span>}</h1>
                {lead && <p class="lead">{lead}</p>}
                {children}
            </div>
        </section>
    );
}

// ---- Needs attention ----

export function Attention() {
    const items = attention.value;
    const siteWarnings = app.value?.siteReadiness?.warnings ?? [];
    const groups = ['projects', 'experience', 'awards', 'courses', 'skills']
        .map(type => [type, items.filter(i => i.type === type)])
        .filter(([, list]) => list.length);

    if (!items.length && !siteWarnings.length) {
        return <PageShell title="Needs attention"><EmptyState icon="check" title="All clear">Every public item is ready, and nothing is blocking a publish.</EmptyState></PageShell>;
    }
    return (
        <PageShell title="Needs attention" count={items.length + (siteWarnings.length ? 1 : 0)}
            lead="Errors stop an item from being published. Suggestions make it stronger. Click any line to jump to the field.">
            {siteWarnings.length > 0 && (
                <div class="att-group">
                    <h2>Site text</h2>
                    <ul class="att-list">
                        {siteWarnings.map(w => (
                            <li><button type="button" class="issue warn" onClick={() => { navigate(`/site/${w.field.split('.')[0]}`); setTimeout(() => focusField(w.field), 80); }}>
                                <Icon name="alert" size={14} /><span>{w.msg}</span><Icon name="chevron" size={12} class="issue-go" /></button></li>
                        ))}
                    </ul>
                </div>
            )}
            {groups.map(([type, list]) => (
                <div class="att-group">
                    <h2>{TYPES[type].label}</h2>
                    <ul class="att-list">
                        {list.map(item => (
                            <li class="att-item">
                                <button type="button" class="att-title" onClick={() => navigate(itemPath(type, item.id))}>
                                    {titleOf(item)} <ReadyBadge readiness={item.readiness} />
                                </button>
                                <ul>
                                    {[...item.readiness.errors.map(r => ['err', r]), ...item.readiness.warnings.map(r => ['warn', r])].slice(0, 6).map(([k, r]) => (
                                        <li><button type="button" class={'issue ' + k} onClick={() => { navigate(itemPath(type, item.id)); setTimeout(() => focusField(r.field), 120); }}>
                                            <Icon name="alert" size={14} /><span>{r.msg}</span><Icon name="chevron" size={12} class="issue-go" /></button></li>
                                    ))}
                                </ul>
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
        </PageShell>
    );
}

// ---- Résumés ----

const LENSES = [{ value: 'design', label: 'Design' }, { value: 'programming', label: 'Programming' }, { value: 'production', label: 'Production' }];

export function Resumes() {
    const list = app.value?.resumes ?? [];
    const update = (i, patch) => saveResumes(list.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    const live = list.filter(r => r.status === 'live').length;
    return (
        <PageShell title="Résumés" count={list.length}
            lead="Only résumés marked Live are published. The first live one is the default on the Résumé page.">
            {list.length === 0 && <EmptyState icon="resumes" title="No résumés yet">Add a PDF to the vault’s resumes folder and list it in resumes.json.</EmptyState>}
            <ul class="cards">
                {list.map((r, i) => (
                    <li class="card">
                        <div class="card-main">
                            <Field label="Label">{fid => <TextInput id={fid} value={r.label} onInput={v => update(i, { label: v })} />}</Field>
                            <Field label="Lens">{fid => <Select id={fid} value={r.lens} placeholder="General" onChange={v => update(i, { lens: v || undefined })} options={LENSES} />}</Field>
                        </div>
                        <div class="card-side">
                            <Switch checked={r.status === 'live'} onChange={v => update(i, { status: v ? 'live' : 'draft' })} label={r.status === 'live' ? 'Live' : 'Draft'}
                                description={r.status === 'live' ? 'Published to the site' : 'Not published'} />
                            <span class="muted file"><Icon name="file" size={13} /> {r.file}</span>
                        </div>
                    </li>
                ))}
            </ul>
            {list.length > 0 && live === 0 && <p class="error-text" role="alert">No résumé is live. Publishing needs at least one.</p>}
        </PageShell>
    );
}

// ---- Site text ----

const SECTIONS = [['home', 'Home'], ['about', 'About'], ['contact', 'Contact'], ['lenses', 'Role pages']];
const get = (o, path) => path.split('.').reduce((a, k) => a?.[k], o);

export function SiteText() {
    const site = app.value?.site ?? {};
    const section = SECTIONS.some(([k]) => k === route.value.id) ? route.value.id : 'home';
    const val = p => get(site, p);
    const set = p => v => editSite(p, v);
    const warnings = (app.value?.siteReadiness?.warnings ?? []).filter(w => w.field.startsWith(section));

    // Readiness jumps to a field by dotted path.
    const target = ui.focusField.value;
    useEffect(() => {
        if (!target || !target.path.includes('.')) return;
        const el = document.querySelector(`[data-field="${target.path}"]`);
        el?.scrollIntoView({ block: 'center' });
        el?.querySelector('input,textarea')?.focus({ preventScroll: true });
    }, [target?.n, section]);

    return (
        <PageShell title="Site text" lead="The words on Home, About, Contact and the role pages. Your wording is shown exactly as written.">
            <div class="segmented wide" role="group" aria-label="Site sections">
                {SECTIONS.map(([k, label]) => (
                    <button type="button" aria-pressed={section === k ? 'true' : 'false'}
                        onClick={() => navigate(`/site/${k}`)}>{label}</button>
                ))}
            </div>
            {warnings.map(w => <div class="ready has-warn"><ul><li><button type="button" class="issue warn" onClick={() => focusField(w.field)}><Icon name="alert" size={14} /><span>{w.msg}</span></button></li></ul></div>)}

            {section === 'home' && (
                <div class="form">
                    <Field path="home.role" label="Role">{fid => <TextInput id={fid} value={val('home.role')} onInput={set('home.role')} />}</Field>
                    <Field path="home.tagline" label="Tagline">{fid => <TextArea id={fid} value={val('home.tagline')} onInput={set('home.tagline')} />}</Field>
                    <Field path="home.proof" label="Proof line" hint="One concrete line under the tagline, such as a shipped game or a number. Leave empty to hide it.">
                        {fid => <TextArea id={fid} value={val('home.proof')} onInput={set('home.proof')} />}
                    </Field>
                    <Field path="home.openTo" label="Availability">{fid => <TextInput id={fid} value={val('home.openTo')} onInput={set('home.openTo')} />}</Field>
                </div>
            )}

            {section === 'about' && (
                <div class="form">
                    <div class="grid2">
                        <Field path="about.name" label="Name">{fid => <TextInput id={fid} value={val('about.name')} onInput={set('about.name')} />}</Field>
                        <Field path="about.title" label="Title">{fid => <TextInput id={fid} value={val('about.title')} onInput={set('about.title')} />}</Field>
                    </div>
                    <Field path="about.bio" label="Bio" hint="One paragraph per box.">
                        <ListEditor items={val('about.bio') ?? []} onChange={set('about.bio')} makeItem={() => ''} addLabel="Add a paragraph" itemLabel="paragraph"
                            renderRow={(v, i, update) => <TextArea value={v} rows={3} aria-label={`Bio paragraph ${i + 1}`} onInput={update} />} />
                    </Field>
                    <Field path="about.lookingFor" label="What you are looking for">{fid => <TextArea id={fid} value={val('about.lookingFor')} onInput={set('about.lookingFor')} />}</Field>
                    <Field path="about.stats" label="Facts">
                        <ListEditor items={val('about.stats') ?? []} onChange={set('about.stats')} makeItem={() => ({ label: '', value: '' })} addLabel="Add a fact" itemLabel="fact"
                            renderRow={(s, i, update) => (
                                <div class="pair">
                                    <TextInput value={s.label} aria-label={`Fact ${i + 1} label`} placeholder="Label" onInput={v => update({ ...s, label: v })} />
                                    <TextInput value={s.value} aria-label={`Fact ${i + 1} value`} placeholder="Value" onInput={v => update({ ...s, value: v })} />
                                </div>
                            )} />
                    </Field>
                    <h2 class="form-h">Education</h2>
                    <div class="grid2">
                        <Field path="about.education.school" label="School">{fid => <TextInput id={fid} value={val('about.education.school')} onInput={set('about.education.school')} />}</Field>
                        <Field path="about.education.dates" label="Dates">{fid => <TextInput id={fid} value={val('about.education.dates')} onInput={set('about.education.dates')} />}</Field>
                    </div>
                    <Field path="about.education.degrees" label="Degrees">{fid => <TextInput id={fid} value={val('about.education.degrees')} onInput={set('about.education.degrees')} />}</Field>
                    <Field path="about.education.honors" label="Honors">{fid => <TextInput id={fid} value={val('about.education.honors')} onInput={set('about.education.honors')} />}</Field>
                </div>
            )}

            {section === 'contact' && (
                <div class="form">
                    <Field path="contact.nodes" label="Contact links" hint="Shown in this order on the Contact page. The first is the main one.">
                        <ListEditor items={val('contact.nodes') ?? []} onChange={set('contact.nodes')} makeItem={() => ({ id: `link-${Date.now() % 100000}`, label: '', handle: '', href: '' })}
                            addLabel="Add a link" itemLabel="contact link"
                            renderRow={(n, i, update) => (
                                <div class="triple">
                                    <TextInput value={n.label} aria-label={`Contact ${i + 1} name`} placeholder="Name, e.g. LinkedIn" onInput={v => update({ ...n, label: v })} />
                                    <TextInput value={n.handle} aria-label={`Contact ${i + 1} shown text`} placeholder="Shown text" onInput={v => update({ ...n, handle: v })} />
                                    <TextInput value={n.href} aria-label={`Contact ${i + 1} address`} placeholder="https:// or mailto:" spellcheck={false} onInput={v => update({ ...n, href: v })} />
                                </div>
                            )} />
                    </Field>
                </div>
            )}

            {section === 'lenses' && (
                <div class="form">
                    {['design', 'programming', 'production'].map(k => (
                        <fieldset class="group">
                            <legend>{k[0].toUpperCase() + k.slice(1)} page</legend>
                            <Field path={`lenses.${k}.title`} label="Title shown">{fid => <TextInput id={fid} value={val(`lenses.${k}.title`)} onInput={set(`lenses.${k}.title`)} />}</Field>
                            <Field path={`lenses.${k}.summary`} label="Summary">{fid => <TextArea id={fid} rows={3} value={val(`lenses.${k}.summary`)} onInput={set(`lenses.${k}.summary`)} />}</Field>
                        </fieldset>
                    ))}
                </div>
            )}
        </PageShell>
    );
}

// ---- Media library ----

export function MediaLibrary() {
    const [files, setFiles] = useState(null);
    const [error, setError] = useState('');
    const [filter, setFilter] = useState('all');

    useEffect(() => {
        api.get('/api/media').then(setFiles, e => setError(e.message));
    }, []);

    const shown = (files ?? []).filter(f => {
        if (filter === 'unused') return !f.usedBy?.length;
        if (filter === 'video') return isVideo(f.src);
        if (filter === 'image') return !isVideo(f.src);
        return true;
    });
    const unused = (files ?? []).filter(f => !f.usedBy?.length).length;
    const total = (files ?? []).reduce((a, f) => a + (f.bytes || 0), 0);

    return (
        <PageShell title="Media" count={files?.length} lead={files ? `${fmtBytes(total)} in the vault. ${unused} not used by any item.` : undefined}>
            <div class="segmented" role="group" aria-label="Show">
                {[['all', 'All'], ['image', 'Images'], ['video', 'Videos'], ['unused', `Unused (${unused})`]].map(([k, l]) => (
                    <button type="button" aria-pressed={filter === k ? 'true' : 'false'} onClick={() => setFilter(k)}>{l}</button>
                ))}
            </div>
            {error && <p class="error-text" role="alert">{error}</p>}
            {!files && !error && <p class="muted" role="status">Loading…</p>}
            {files && shown.length === 0 && <EmptyState icon="media" title="Nothing here">No files match this filter.</EmptyState>}
            <ul class="media-lib">
                {shown.map(f => {
                    const video = isVideo(f.src);
                    const src = video ? posterFor(f.src) : f.src;
                    const name = f.src.split('/').pop();
                    return (
                        <li class="mcard">
                            <div class="thumb"><img src={src} alt="" loading="lazy" onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />{video && <span class="thumb-badge"><Icon name="play" size={10} /> Video</span>}</div>
                            <div class="mcard-info">
                                <span class="mname" title={f.src}>{name}</span>
                                <span class="muted">{fmtBytes(f.bytes)}</span>
                                {f.usedBy?.length
                                    ? <span class="used">{f.usedBy.map(u => <button type="button" class="link-btn" onClick={() => navigate(itemPath(u.type, u.id))}>{u.id}</button>)}</span>
                                    : <span class="muted">Unused</span>}
                            </div>
                        </li>
                    );
                })}
            </ul>
        </PageShell>
    );
}

// ---- Trash ----

export function Trash() {
    const [list, setList] = useState(null);
    const [error, setError] = useState('');
    const load = () => api.get('/api/trash').then(r => setList(Array.isArray(r) ? r : r.items ?? []), e => setError(e.message));
    useEffect(() => { load(); }, []);

    const restore = async t => {
        try {
            const r = await api.post(`/api/trash/${encodeURIComponent(t.trashId ?? t.id)}/restore`);
            await loadState();
            toast(`Restored “${t.title ?? t.id}”`, { label: 'Open', action: () => navigate(itemPath(r.item.type, r.item.id)) });
            load();
        } catch (e) { toast(`Couldn’t restore: ${e.message}`, { kind: 'error' }); }
    };

    return (
        <PageShell title="Trash" count={list?.length} lead="Deleted items are kept here, and in the vault’s history, so nothing is lost.">
            {error && <p class="error-text" role="alert">{error}</p>}
            {list && list.length === 0 && <EmptyState icon="trash" title="Trash is empty">Deleted items show up here so you can restore them.</EmptyState>}
            <ul class="cards compact">
                {(list ?? []).map(t => (
                    <li class="card trash-row">
                        <div class="card-main">
                            <strong>{t.title ?? t.id}</strong>
                            <span class="muted">{TYPES[t.type]?.one ?? t.type}{t.deletedAt ? ` · deleted ${ago(new Date(t.deletedAt).getTime())}` : ''}</span>
                        </div>
                        <button type="button" class="btn" onClick={() => restore(t)}><Icon name="undo" size={14} /> Restore</button>
                    </li>
                ))}
            </ul>
        </PageShell>
    );
}
