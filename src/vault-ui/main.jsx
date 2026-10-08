import { render } from 'preact';
import { useEffect } from 'preact/hooks';
import './styles.css';
import {
    app, loadError, loadState, startEvents, route, navigate, itemPath, ui, sorted, flushAll,
} from './store.js';
import { installKeys } from './keys.js';
import { TYPES } from './meta.js';
import { Sidebar } from './components/Sidebar.jsx';
import { Library } from './components/Library.jsx';
import { ItemEditor } from './components/Editor.jsx';
import { Preview } from './components/Preview.jsx';
import { History } from './components/History.jsx';
import { Palette } from './components/Palette.jsx';
import { PublishPanel } from './components/Publish.jsx';
import { CaptureModal, CaptureForm } from './components/Capture.jsx';
import { Help } from './components/Help.jsx';
import { Toasts, EmptyState } from './components/ui.jsx';
import { Attention, Resumes, SiteText, MediaLibrary, Trash } from './components/Pages.jsx';

const LIST_TYPES = new Set(Object.keys(TYPES));

function ListView({ type }) {
    const { id } = route.value;
    const items = sorted(type);
    const exists = id && items.some(i => i.id === id);

    // Opening a list lands on its first item so the editor is never an empty pane.
    useEffect(() => {
        if (!exists && items.length) navigate(itemPath(type, items[0].id), { replace: true });
    }, [type, exists, items.length]);

    const showPreview = ui.preview.value && TYPES[type].publishable && exists;
    const cls = 'split' + (ui.expanded.value ? ' expanded' : '') + (showPreview ? ' with-preview' : '') + (showPreview && ui.listOver.value ? ' list-over' : '');
    return (
        <div class={cls}>
            <h1 class="visually-hidden">{TYPES[type].label}</h1>
            <Library key={type} type={type} />
            <div class="editor-pane">
                <div class="editor-scroll" id="editor-scroll">
                    {exists ? <ItemEditor key={`${type}/${id}`} type={type} id={id} />
                        : <EmptyState icon={TYPES[type].icon} title={items.length ? 'Pick one to edit' : 'Nothing to edit yet'} />}
                </div>
                {showPreview && <Preview type={type} id={id} />}
            </div>
            {ui.history.value && exists && <History type={type} id={id} />}
        </div>
    );
}

function View() {
    const { view } = route.value;
    if (LIST_TYPES.has(view)) return <ListView type={view} />;
    switch (view) {
        case 'attention': return <Attention />;
        case 'resumes': return <Resumes />;
        case 'site': return (
            <div class={'split page-split' + (ui.preview.value ? ' with-preview' : '')}>
                <div class="editor-scroll"><SiteText /></div>
                {ui.preview.value && <Preview path={{ home: '/', about: '/about/', contact: '/contact/', lenses: '/for/design/' }[route.value.id] ?? '/'} />}
            </div>
        );
        case 'media': return <MediaLibrary />;
        case 'trash': return <Trash />;
        default:
            return <EmptyState icon="alert" title="Nothing here"><a href="/projects" onClick={e => { e.preventDefault(); navigate('/projects'); }}>Go to Projects</a></EmptyState>;
    }
}

function StandaloneCapture() {
    return (
        <main class="standalone">
            <div class="standalone-card">
                <h1>Quick capture</h1>
                <CaptureForm standalone />
                <p class="muted standalone-foot">Captures wait in the Inbox, private, until you file them. <button type="button" class="link-btn" onClick={() => window.close()}>Close this window</button></p>
            </div>
        </main>
    );
}

function App() {
    const s = app.value;
    if (loadError.value && !s) {
        return (
            <main class="boot">
                <EmptyState icon="alert" title="Can’t reach the vault">
                    {loadError.value}. Start it with <code>npm run vault</code>, then <button type="button" class="link-btn" onClick={loadState}>try again</button>.
                </EmptyState>
            </main>
        );
    }
    if (!s) return <main class="boot" aria-busy="true"><p class="muted" role="status">Opening the vault…</p></main>;

    if (route.value.view === 'capture') return <><StandaloneCapture /><Toasts /></>;

    return (
        <div class="app">
            <a class="skip" href="#main">Skip to content</a>
            <Sidebar />
            <main id="main" class="main"><View /></main>
            {ui.palette.value && <Palette />}
            {ui.publish.value && <PublishPanel />}
            {ui.capture.value && <CaptureModal />}
            {ui.help.value && <Help />}
            <Toasts />
        </div>
    );
}

// Titles follow the view so the window and history entries read well.
function useTitle() {
    const { view, id } = route.value;
    document.title = `${TYPES[view]?.label ?? view[0].toUpperCase() + view.slice(1)}${id ? ` · ${id}` : ''} · Vault`;
}

function Root() {
    useTitle();
    return <App />;
}

installKeys();
loadState().then(() => {
    startEvents();
    // The root path lands on Projects.
    if (location.pathname === '/') navigate('/projects', { replace: true });
});
window.addEventListener('blur', flushAll);
render(<Root />, document.getElementById('app'));
