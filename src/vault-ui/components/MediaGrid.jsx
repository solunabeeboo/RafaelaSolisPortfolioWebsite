// Media for a project: upload (drop, paste, browse), cover, per-tile alt/caption, reorder, remove with undo.
import { useRef, useState, useEffect } from 'preact/hooks';
import { Icon, StarFilled } from '../icons.jsx';
import { upload } from '../api.js';
import { editData, getItem, toast } from '../store.js';
import { mediaObj, mediaOut, isVideo, posterFor } from '../meta.js';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/avif,image/gif,video/mp4,video/webm,video/quicktime';
const OK_TYPE = /^(image\/(png|jpe?g|webp|avif|gif)|video\/(mp4|webm|quicktime))$/;

/** The cover may not be in `media`; show it first so it can be edited like the rest. */
function tilesOf(data) {
    const list = (data.media ?? []).map(mediaObj);
    if (data.image && !list.some(m => m.src === data.image)) list.unshift({ src: data.image });
    return list;
}

function Thumb({ tile }) {
    const [failed, setFailed] = useState(false);
    const video = isVideo(tile.src);
    const src = video ? (tile.poster || posterFor(tile.src)) : tile.src;
    return (
        <div class="thumb">
            {failed ? <div class="thumb-missing"><Icon name={video ? 'film' : 'media'} size={22} /><span>{video ? 'No poster' : 'Missing file'}</span></div>
                : <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />}
            {video && <span class="thumb-badge"><Icon name="play" size={10} /> Video</span>}
        </div>
    );
}

export function MediaGrid({ item, isPublic }) {
    const { type, id } = item;
    const [busy, setBusy] = useState([]); // { key, name, pct }
    const [dragging, setDragging] = useState(false);
    const dragFrom = useRef(null);
    const [over, setOver] = useState(null);
    const fileInput = useRef(null);
    const zone = useRef(null);

    const tiles = tilesOf(item.data);
    const cover = item.data.image;

    const write = (next, image = cover) => {
        const cur = getItem(type, id);
        editData(type, id, 'media', next.map(mediaOut));
        if (image !== cur.data.image) editData(type, id, 'image', image || undefined);
    };

    const addFiles = async files => {
        const list = [...files].filter(f => OK_TYPE.test(f.type));
        if (list.length < files.length) toast('Some files were skipped (use PNG, JPG, WebP, AVIF, GIF, MP4 or WebM)', { kind: 'error' });
        for (const file of list) {
            const key = Math.random();
            setBusy(b => [...b, { key, name: file.name || 'Pasted image', pct: 0 }]);
            upload(file, {
                type, id,
                onProgress: pct => setBusy(b => b.map(x => (x.key === key ? { ...x, pct } : x))),
            }).then(res => {
                const cur = getItem(type, id);
                if (!cur) return;
                const entry = { src: res.src };
                if (res.poster && res.poster !== posterFor(res.src)) entry.poster = res.poster;
                const next = [...tilesOf(cur.data), entry];
                const image = cur.data.image || (isVideo(res.src) ? undefined : res.src);
                const before = getItem(type, id).data;
                editData(type, id, 'media', next.map(mediaOut));
                if (image && image !== before.image) editData(type, id, 'image', image);
            }).catch(e => toast(`Couldn’t add ${file.name || 'image'}: ${e.message}`, { kind: 'error' }))
              .finally(() => setBusy(b => b.filter(x => x.key !== key)));
        }
    };

    // Pasted screenshots attach to the open project.
    useEffect(() => {
        const onPaste = e => {
            const files = [...(e.clipboardData?.items ?? [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
            if (!files.length) return;
            e.preventDefault();
            addFiles(files);
        };
        window.addEventListener('paste', onPaste);
        return () => window.removeEventListener('paste', onPaste);
    }, [type, id]);

    const patch = (i, p) => write(tiles.map((t, j) => (j === i ? { ...t, ...p } : t)));

    const remove = i => {
        const before = { media: item.data.media, image: item.data.image };
        const gone = tiles[i];
        write(tiles.filter((_, j) => j !== i), gone.src === cover ? undefined : cover);
        toast('Removed from this project. The file stays in the vault.', {
            label: 'Undo',
            action: () => {
                editData(type, id, 'media', before.media ?? []);
                editData(type, id, 'image', before.image);
            },
        });
    };

    const move = (from, to) => {
        if (from === to || from == null) return;
        const next = tiles.slice();
        const [t] = next.splice(from, 1);
        next.splice(to, 0, t);
        write(next);
    };

    const onDrop = e => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
    };

    return (
        <div class={'media' + (dragging ? ' is-dragging' : '')}
            ref={zone}
            onDragOver={e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setDragging(true); } }}
            onDragLeave={e => { if (!zone.current.contains(e.relatedTarget)) setDragging(false); }}
            onDrop={onDrop}>
            <div class="media-grid">
                {tiles.map((t, i) => {
                    const video = isVideo(t.src);
                    const isCover = t.src === cover;
                    const noAlt = !t.alt && !t.hidden;
                    const name = t.src.split('/').pop();
                    return (
                        <div class={'tile' + (t.hidden ? ' is-hidden' : '') + (over === i ? ' drop-target' : '')} key={t.src}
                            data-field={`media.${i}`}
                            onDragOver={e => { if (dragFrom.current !== null) { e.preventDefault(); setOver(i); } }}
                            onDragLeave={() => setOver(null)}
                            onDrop={e => { if (dragFrom.current !== null) { e.preventDefault(); e.stopPropagation(); setOver(null); move(dragFrom.current, i); dragFrom.current = null; } }}>
                            <div class="tile-media" draggable="true"
                                onDragStart={e => { dragFrom.current = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.src); }}
                                onDragEnd={() => { dragFrom.current = null; setOver(null); }}>
                                <Thumb tile={t} />
                                <button type="button" class={'tile-btn tile-cover' + (isCover ? ' on' : '')} aria-pressed={isCover ? 'true' : 'false'}
                                    aria-label={isCover ? `${name} is the cover` : `Use ${name} as the cover`}
                                    title={isCover ? 'Cover' : 'Make cover'}
                                    onClick={() => !video && write(tiles, isCover ? undefined : t.src)} disabled={video}>
                                    {isCover ? <StarFilled size={14} /> : <Icon name="star" size={14} />}
                                </button>
                                <button type="button" class="tile-btn tile-remove" aria-label={`Remove ${name}`} title="Remove" onClick={() => remove(i)}>
                                    <Icon name="x" size={14} />
                                </button>
                                {isCover && <span class="tile-flag">Cover</span>}
                            </div>
                            <div class="tile-fields">
                                <input class={'input small' + (noAlt && isPublic ? ' warn' : '')} type="text" value={t.alt ?? ''}
                                    aria-label={`Alt text for ${name}`} placeholder="Alt text: what is shown, and why"
                                    onInput={e => patch(i, { alt: e.currentTarget.value })} />
                                <input class="input small" type="text" value={t.caption ?? ''}
                                    aria-label={`Caption for ${name}`} placeholder="Caption (optional)"
                                    onInput={e => patch(i, { caption: e.currentTarget.value })} />
                                <label class="check small">
                                    <input type="checkbox" checked={!t.hidden} onChange={e => patch(i, { hidden: !e.currentTarget.checked })} />
                                    Show on site
                                </label>
                            </div>
                        </div>
                    );
                })}
                {busy.map(b => (
                    <div class="tile tile-busy" key={b.key} role="status">
                        <div class="tile-media"><div class="thumb"><div class="thumb-missing"><Icon name="upload" size={20} /><span>{b.name}</span></div></div></div>
                        <div class="progress" role="progressbar" aria-valuenow={b.pct} aria-valuemin="0" aria-valuemax="100" aria-label={`Uploading ${b.name}`}>
                            <div style={{ width: `${b.pct}%` }} />
                        </div>
                        <span class="muted small-text">{b.pct < 40 ? 'Uploading' : 'Optimizing'} {b.pct}%</span>
                    </div>
                ))}
                <button type="button" class="tile tile-add" onClick={() => fileInput.current.click()}>
                    <Icon name="upload" size={20} />
                    <span>Add images or video</span>
                    <span class="muted small-text">Drop, paste or browse</span>
                </button>
            </div>
            <input ref={fileInput} type="file" class="visually-hidden" multiple accept={ACCEPT} aria-label="Add media files" tabIndex={-1}
                onChange={e => { addFiles(e.currentTarget.files); e.currentTarget.value = ''; }} />
            {dragging && <div class="drop-veil" aria-hidden="true">Drop to add to this project</div>}
            {tiles.length > 0 && <p class="hint">The star marks the cover. Drag tiles to reorder. Uploads are converted to WebP (images) or H.264 (video).</p>}
        </div>
    );
}
