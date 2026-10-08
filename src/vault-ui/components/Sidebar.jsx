// Left navigation: capture, search, sections with counts, save status and the publish chip.
import { Icon } from '../icons.jsx';
import {
    app, route, navigate, collection, inboxCount, attention, ui, saveStatus, publishInfo, retrySave, connected,
} from '../store.js';

function NavItem({ path, icon, label, count, active, tone }) {
    return (
        <li>
            <a href={path} class={'nav-item' + (active ? ' active' : '')} aria-current={active ? 'page' : undefined}
                onClick={e => { if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return; e.preventDefault(); navigate(path); ui.expanded.value = false; }}>
                <Icon name={icon} size={16} />
                <span class="nav-label">{label}</span>
                {count > 0 && <span class={'nav-count' + (tone ? ' ' + tone : '')}>{count}</span>}
            </a>
        </li>
    );
}

export function Sidebar() {
    const view = route.value.view;
    const at = p => view === p;
    const n = type => collection(type).length;
    const siteWarn = app.value?.siteReadiness?.warnings?.length ?? 0;
    const status = saveStatus.value;
    const info = publishInfo.value;
    const changes = info ? info.changes.length : (app.value?.pending ?? 0);
    const branch = app.value?.git?.site?.branch;

    return (
        <nav class="sidebar" aria-label="Vault">
            <div class="side-top">
                <div class="brand"><span class="brand-mark" aria-hidden="true"><Icon name="projects" size={14} /></span> Vault</div>
                <button type="button" class="btn capture-btn" onClick={() => { ui.capture.value = true; }}>
                    <Icon name="plus" size={15} /> Capture <kbd>C</kbd>
                </button>
                <button type="button" class="search-btn" onClick={() => { ui.palette.value = true; }}>
                    <Icon name="search" size={14} /> <span>Search</span> <kbd>Ctrl K</kbd>
                </button>
            </div>

            <div class="side-scroll">
                <ul class="nav-group">
                    <NavItem path="/inbox" icon="inbox" label="Inbox" count={inboxCount.value} active={at('inbox')} />
                    <NavItem path="/attention" icon="alert" label="Needs attention" count={attention.value.length + (siteWarn ? 1 : 0)} active={at('attention')} tone="amber" />
                </ul>
                <h2 class="nav-head">Portfolio</h2>
                <ul class="nav-group">
                    <NavItem path="/projects" icon="projects" label="Projects" count={n('projects')} active={at('projects')} />
                    <NavItem path="/experience" icon="experience" label="Experience" count={n('experience')} active={at('experience')} />
                    <NavItem path="/awards" icon="awards" label="Awards" count={n('awards')} active={at('awards')} />
                    <NavItem path="/courses" icon="courses" label="Courses" count={n('courses')} active={at('courses')} />
                    <NavItem path="/skills" icon="skills" label="Skills" count={n('skills')} active={at('skills')} />
                    <NavItem path="/resumes" icon="resumes" label="Résumés" active={at('resumes')} />
                    <NavItem path="/site" icon="site" label="Site text" active={at('site')} />
                </ul>
                <h2 class="nav-head">Archive</h2>
                <ul class="nav-group">
                    <NavItem path="/notes" icon="notes" label="Notes" count={n('notes')} active={at('notes')} />
                    <NavItem path="/media" icon="media" label="Media" active={at('media')} />
                    <NavItem path="/trash" icon="trash" label="Trash" active={at('trash')} />
                </ul>
            </div>

            <div class="side-foot">
                {!connected.value && <p class="conn" role="alert">Lost connection to the vault. Reconnecting…</p>}
                <p class={'save-status ' + status.state} role="status" aria-live="polite">
                    {status.state === 'saved' && <><Icon name="check" size={13} /> All changes saved</>}
                    {status.state === 'saving' && <>Saving…</>}
                    {status.state === 'error' && <><Icon name="alert" size={13} /> Couldn’t save. <button type="button" class="link-btn" onClick={retrySave}>Retry</button></>}
                </p>
                {status.state === 'error' && status.detail && <p class="save-detail">{status.detail}</p>}
                <button type="button" class={'publish-chip' + (changes ? ' has' : '')} onClick={() => { ui.publish.value = true; }}>
                    <span class="chip-text">
                        <strong>{changes ? `${changes} ${changes === 1 ? 'change' : 'changes'} not published` : 'Nothing to publish'}</strong>
                        <span>{branch ? `Branch ${branch}${branch === 'main' ? ' (live)' : ', not live'}` : 'Review and publish'}</span>
                    </span>
                    <span class="chip-go">Publish <kbd>Ctrl ↵</kbd></span>
                </button>
            </div>
        </nav>
    );
}
