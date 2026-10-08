// Live preview of the real site page for the open item, at desktop or phone width.
import { useState, useRef, useEffect } from 'preact/hooks';
import { Icon } from '../icons.jsx';
import { PREVIEW_BASE, previewTick, ui, app, loadState } from '../store.js';
import { TYPES } from '../meta.js';

// Only project pages have a draft-backed preview route; everything else shows the published snapshot.
export const hasDraftPreview = type => type === 'projects';

const SIZES = { desktop: { w: 1024, label: 'Desktop', icon: 'desktop' }, phone: { w: 390, label: 'Phone', icon: 'phone' } };

export function pagePath(type, id) {
    return type === 'projects' ? `/__preview/projects/${encodeURIComponent(id)}` : TYPES[type]?.page ?? '/';
}

export function Preview({ type, id, path }) {
    const draft = hasDraftPreview(type);
    const [size, setSize] = useState('desktop');
    const [box, setBox] = useState({ w: 600, h: 600 });
    const stage = useRef(null);
    const preview = app.value?.preview;
    const up = preview ? preview.running !== false : true;
    const base = (preview?.url || PREVIEW_BASE).replace(/\/$/, '');
    const url = base + (path ?? pagePath(type, id));

    useEffect(() => {
        const el = stage.current;
        const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const vw = SIZES[size].w;
    const scale = Math.min(1, (box.w - 24) / vw);
    const height = (box.h - 24) / scale;

    return (
        <aside class="preview" aria-label="Live preview">
            <div class="preview-bar">
                <div class="segmented" role="group" aria-label="Preview width">
                    {Object.entries(SIZES).map(([k, s]) => (
                        <button type="button" aria-pressed={size === k ? 'true' : 'false'} onClick={() => setSize(k)}>
                            <Icon name={s.icon} size={13} /> {s.label}
                        </button>
                    ))}
                </div>
                <button type="button" class="btn small ghost list-toggle" aria-pressed={ui.listOver.value ? 'true' : 'false'} onClick={() => { ui.listOver.value = !ui.listOver.value; }}>Items</button>
                <a class="btn small ghost" href={url} target="_blank" rel="noreferrer"><Icon name="external" size={13} /> Open</a>
                <button type="button" class="icon-btn" aria-label="Close preview" onClick={() => { ui.preview.value = false; }}><Icon name="x" size={15} /></button>
            </div>
            {!draft && (
                <p class="preview-note" role="note">Showing the published site. Your edits here don’t appear until you publish.</p>
            )}
            <div class="preview-stage" ref={stage}>
                {!up ? (
                    <div class="preview-down">
                        <Icon name="alert" size={20} />
                        <p><strong>The site preview isn’t running.</strong></p>
                        <p class="muted">The vault starts it automatically. If it just launched, give it a few seconds.</p>
                        <button type="button" class="btn small" onClick={loadState}>Try again</button>
                    </div>
                ) : (
                    <div class="frame" style={{ width: vw * scale + 'px', height: height * scale + 'px' }}>
                        <iframe title={`Preview of ${id ?? 'page'}`} src={`${url}${url.includes('?') ? '&' : '?'}v=${previewTick.value}`}
                            style={{ width: vw + 'px', height: height + 'px', transform: `scale(${scale})` }} />
                    </div>
                )}
            </div>
        </aside>
    );
}
