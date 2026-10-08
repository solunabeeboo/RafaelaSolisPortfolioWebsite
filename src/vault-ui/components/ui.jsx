// Small shared pieces: modal, menu, toasts, badges, empty state.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from '../icons.jsx';
import { toasts, dismissToast } from '../store.js';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])';

/** Centered dialog with focus trap, Esc to close and focus restore. */
export function Modal({ title, onClose, children, width = 560, top = false, labelledBy }) {
    const ref = useRef(null);
    useEffect(() => {
        const prev = document.activeElement;
        const el = ref.current;
        const first = el.querySelector('[data-autofocus]') || el.querySelector(FOCUSABLE);
        first?.focus();
        return () => { if (prev && document.contains(prev)) prev.focus?.(); };
    }, []);
    const onKeyDown = e => {
        if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
        if (e.key !== 'Tab') return;
        const nodes = [...ref.current.querySelectorAll(FOCUSABLE)].filter(n => n.offsetParent !== null);
        if (!nodes.length) return;
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    return (
        <div class={'scrim' + (top ? ' scrim-top' : '')} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div class="modal" role="dialog" aria-modal="true" aria-label={labelledBy ? undefined : title} aria-labelledby={labelledBy}
                style={{ width: `min(${width}px, calc(100vw - 32px))` }} ref={ref} onKeyDown={onKeyDown}>
                {children}
            </div>
        </div>
    );
}

export function Menu({ label, icon = 'more', items, align = 'right' }) {
    const [open, setOpen] = useState(false);
    const root = useRef(null);
    useEffect(() => {
        if (!open) return;
        const away = e => { if (!root.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', away);
        return () => document.removeEventListener('mousedown', away);
    }, [open]);
    const onKeyDown = e => {
        if (e.key === 'Escape' && open) { e.stopPropagation(); setOpen(false); root.current.querySelector('button').focus(); }
        if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            const btns = [...root.current.querySelectorAll('[role=menuitem]')];
            const i = btns.indexOf(document.activeElement);
            btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]?.focus();
        }
    };
    return (
        <div class="menu" ref={root} onKeyDown={onKeyDown}>
            <button type="button" class="icon-btn lg" aria-label={label} aria-haspopup="menu" aria-expanded={open ? 'true' : 'false'}
                onClick={() => { setOpen(o => !o); setTimeout(() => root.current.querySelector('[role=menuitem]')?.focus(), 0); }}>
                <Icon name={icon} />
            </button>
            {open && (
                <div class={'popover ' + align} role="menu" aria-label={label}>
                    {items.filter(Boolean).map(it => (
                        <button type="button" role="menuitem" class={'menu-item' + (it.danger ? ' danger' : '')}
                            onClick={() => { setOpen(false); it.run(); }}>
                            {it.icon && <Icon name={it.icon} size={15} />}
                            <span>{it.label}</span>
                            {it.hint && <kbd>{it.hint}</kbd>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export function Toasts() {
    return (
        <div class="toasts" role="region" aria-label="Notifications" aria-live="polite">
            {toasts.value.map(t => (
                <div class={'toast ' + t.kind} key={t.id} role={t.kind === 'error' ? 'alert' : 'status'}>
                    <span class="toast-msg">{t.message}</span>
                    {t.action && <button type="button" class="toast-action" onClick={() => { t.action(); dismissToast(t.id); }}>{t.label}</button>}
                    <button type="button" class="icon-btn" aria-label="Dismiss" onClick={() => dismissToast(t.id)}><Icon name="x" size={14} /></button>
                </div>
            ))}
        </div>
    );
}

/** Counts of readiness problems as a compact pill. */
export function ReadyBadge({ readiness, publicOnly = false }) {
    const errors = readiness?.errors?.length ?? 0;
    const warnings = readiness?.warnings?.length ?? 0;
    if (errors) return <span class="badge err" title={readiness.errors.map(e => e.msg).join('\n')} aria-label={`${errors} ${errors === 1 ? 'error' : 'errors'}`}>{errors}</span>;
    if (warnings && !publicOnly) return <span class="badge warn" title={readiness.warnings.map(e => e.msg).join('\n')} aria-label={`${warnings} ${warnings === 1 ? 'warning' : 'warnings'}`}>{warnings}</span>;
    return null;
}

export function EmptyState({ icon = 'inbox', title, children, action }) {
    return (
        <div class="empty">
            <div class="empty-icon"><Icon name={icon} size={22} /></div>
            <h2>{title}</h2>
            {children && <p>{children}</p>}
            {action}
        </div>
    );
}

export function Kbd({ children }) {
    return <kbd>{children}</kbd>;
}
