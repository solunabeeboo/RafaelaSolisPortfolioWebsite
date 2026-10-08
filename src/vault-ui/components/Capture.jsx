// Quick capture: one box, optional link and files, saved straight to the Inbox.
import { useState, useRef, useEffect } from 'preact/hooks';
import { Icon } from '../icons.jsx';
import { upload } from '../api.js';
import { createItem, editData, getItem, toast, navigate, itemPath, ui } from '../store.js';
import { Modal } from './ui.jsx';
import { fmtBytes } from '../meta.js';

function guessKind(text, url, files) {
    const hay = [text, url, ...files.map(f => f.name)].join(' ');
    if (/itch\.io|github\.com/i.test(hay)) return 'project';
    if (/certificate|award|badge|scholarship/i.test(hay)) return 'award';
    return 'note';
}

function splitText(raw) {
    const text = raw.trim();
    // A pasted link becomes the link field instead of cluttering the title.
    const found = text.match(/https?:\/\/\S+/i);
    const url = found ? found[0].replace(/[.,;)]+$/, '') : '';
    const rest = (found ? text.replace(found[0], ' ') : text).trim();
    if (!rest && url) {
        try {
            const u = new URL(url);
            return { title: u.hostname.replace(/^www\./, '') + (u.pathname.length > 1 ? u.pathname.replace(/\/$/, '') : ''), body: '', url };
        } catch { /* fall through */ }
    }
    const [first, ...others] = rest.split('\n');
    return { title: first.replace(/\s+/g, ' ').trim().slice(0, 100), body: others.join('\n').trim(), url };
}

export function CaptureForm({ onSaved, standalone = false }) {
    const [text, setText] = useState('');
    const [url, setUrl] = useState('');
    const [files, setFiles] = useState([]);
    const [busy, setBusy] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');
    const [over, setOver] = useState(false);
    const fileInput = useRef(null);
    const area = useRef(null);

    useEffect(() => { area.current?.focus(); }, [saved]);

    const addFiles = list => setFiles(f => [...f, ...[...list]]);

    const onPaste = e => {
        const pasted = [...(e.clipboardData?.items ?? [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
        if (pasted.length) { e.preventDefault(); e.stopPropagation(); addFiles(pasted); }
    };

    const canSave = (text.trim() || url.trim() || files.length) && !busy;

    const save = async () => {
        if (!canSave) return;
        setBusy(true);
        setError('');
        const parsed = splitText(text || url || files[0]?.name || 'Untitled capture');
        const link = url.trim() || parsed.url;
        const data = { kind: guessKind(text, link, files) };
        if (link) data.url = link;
        try {
            const item = await createItem('inbox', parsed.title || 'Untitled capture', { data, body: parsed.body });
            const attachments = [];
            for (const f of files) {
                try { attachments.push((await upload(f, { type: 'inbox', id: item.id })).src); }
                catch (e) { toast(`Couldn’t attach ${f.name || 'image'}: ${e.message}`, { kind: 'error' }); }
            }
            if (attachments.length && getItem('inbox', item.id)) editData('inbox', item.id, 'attachments', attachments);
            setText(''); setUrl(''); setFiles([]);
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
            onSaved?.(item);
            if (!standalone) toast('Saved to Inbox', { label: 'Open', action: () => navigate(itemPath('inbox', item.id)) });
        } catch (e) {
            setError(e.message);
        } finally {
            setBusy(false);
        }
    };

    return (
        <form class={'capture' + (over ? ' over' : '')} onSubmit={e => { e.preventDefault(); save(); }} onPaste={onPaste}
            onDragOver={e => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); setOver(true); } }}
            onDragLeave={() => setOver(false)}
            onDrop={e => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}>
            <label class="capture-label" for="capture-text">What did you make or do?</label>
            <textarea id="capture-text" ref={area} class="capture-text" rows={standalone ? 5 : 4} value={text} data-autofocus
                placeholder="A game jam entry, a certificate, a link worth keeping…" onInput={e => setText(e.currentTarget.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save(); } }} />
            <div class="capture-row">
                <label class="visually-hidden" for="capture-url">Link</label>
                <input id="capture-url" class="input" type="url" value={url} placeholder="Link (optional)" spellcheck={false}
                    onInput={e => setUrl(e.currentTarget.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(); } }} />
                <button type="button" class="btn" onClick={() => fileInput.current.click()}><Icon name="upload" size={15} /> Add files</button>
                <input ref={fileInput} type="file" multiple class="visually-hidden" tabIndex={-1} aria-label="Add files"
                    onChange={e => { addFiles(e.currentTarget.files); e.currentTarget.value = ''; }} />
            </div>
            {files.length > 0 && (
                <ul class="capture-files">
                    {files.map((f, i) => (
                        <li><Icon name={f.type.startsWith('video') ? 'film' : 'media'} size={14} /> <span>{f.name || 'Pasted image'}</span>
                            <span class="muted">{fmtBytes(f.size)}</span>
                            <button type="button" class="icon-btn" aria-label={`Remove ${f.name || 'pasted image'}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><Icon name="x" size={13} /></button>
                        </li>
                    ))}
                </ul>
            )}
            {error && <p class="error-text" role="alert">{error}</p>}
            <div class="capture-foot">
                <span class="muted" role="status">{saved ? 'Saved to Inbox. Keep going or close this.' : 'Enter to save · Shift+Enter for a new line · paste or drop screenshots'}</span>
                <button type="submit" class="btn primary" disabled={!canSave}>{busy ? 'Saving…' : 'Save to Inbox'}</button>
            </div>
        </form>
    );
}

export function CaptureModal() {
    const onClose = () => { ui.capture.value = false; };
    return (
        <Modal title="Quick capture" onClose={onClose} width={560}>
            <div class="modal-body">
                <div class="modal-head">
                    <h2 class="modal-title">Quick capture</h2>
                    <button type="button" class="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" size={16} /></button>
                </div>
                <CaptureForm />
            </div>
        </Modal>
    );
}
