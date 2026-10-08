// Plain markdown textarea with a small toolbar and Ctrl+B / Ctrl+I. The text is stored exactly as typed.
import { useRef, useLayoutEffect, useEffect } from 'preact/hooks';
import { Icon } from '../icons.jsx';

/** Wraps the selection, or toggles a line prefix. Returns the new { value, start, end }. */
function transform(el, kind) {
    const { value, selectionStart: s, selectionEnd: e } = el;
    const sel = value.slice(s, e);
    const wrap = mark => {
        if (sel.startsWith(mark) && sel.endsWith(mark) && sel.length >= mark.length * 2) {
            const inner = sel.slice(mark.length, -mark.length);
            return { value: value.slice(0, s) + inner + value.slice(e), start: s, end: s + inner.length };
        }
        const text = sel || 'text';
        return { value: value.slice(0, s) + mark + text + mark + value.slice(e), start: s + mark.length, end: s + mark.length + text.length };
    };
    const linePrefix = prefix => {
        const from = value.lastIndexOf('\n', s - 1) + 1;
        let to = value.indexOf('\n', e);
        if (to < 0) to = value.length;
        const lines = value.slice(from, to).split('\n');
        const all = lines.every(l => l.startsWith(prefix));
        const out = lines.map(l => (all ? l.slice(prefix.length) : prefix + l.replace(/^(#{1,6} |- |> )/, ''))).join('\n');
        return { value: value.slice(0, from) + out + value.slice(to), start: from, end: from + out.length };
    };
    switch (kind) {
        case 'bold': return wrap('**');
        case 'italic': return wrap('*');
        case 'h2': return linePrefix('## ');
        case 'h3': return linePrefix('### ');
        case 'list': return linePrefix('- ');
        case 'quote': return linePrefix('> ');
        case 'link': {
            const text = sel || 'link text';
            const out = `[${text}](https://)`;
            const urlStart = s + text.length + 3;
            return { value: value.slice(0, s) + out + value.slice(e), start: urlStart, end: urlStart + 8 };
        }
    }
}

const TOOLS = [
    ['h2', 'Heading', 'H2'],
    ['h3', 'Subheading', 'H3'],
    ['bold', 'Bold (Ctrl+B)', 'bold'],
    ['italic', 'Italic (Ctrl+I)', 'italic'],
    ['list', 'Bulleted list', 'list'],
    ['quote', 'Quote', 'quote'],
    ['link', 'Link', 'link'],
];

export function MarkdownEditor({ value, onInput, id, label, placeholder = 'Write in plain text. Use ## headings, - bullets, and **bold**.' }) {
    const ref = useRef(null);
    const fit = () => {
        const el = ref.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = Math.max(220, el.scrollHeight + 2) + 'px';
    };
    useLayoutEffect(fit, [value]);
    useEffect(() => { document.fonts?.ready.then(fit); }, []);

    const apply = kind => {
        const el = ref.current;
        const r = transform(el, kind);
        if (!r) return;
        el.focus();
        // Replace through the browser's own edit pipeline so Ctrl+Z keeps working afterwards.
        el.setSelectionRange(0, el.value.length);
        let ok = false;
        try { ok = document.execCommand('insertText', false, r.value); } catch { ok = false; }
        if (!ok || el.value !== r.value) { el.value = r.value; onInput(r.value); }
        el.setSelectionRange(r.start, r.end);
    };

    const onKeyDown = e => {
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
            if (e.key === 'b') { e.preventDefault(); apply('bold'); }
            else if (e.key === 'i') { e.preventDefault(); apply('italic'); }
        }
        if (e.key === 'Tab' && !e.shiftKey) {
            // keep Tab for navigation unless she is indenting a list
            return;
        }
        if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
            // continue a bullet list
            const el = e.currentTarget;
            const before = el.value.slice(0, el.selectionStart);
            const line = before.slice(before.lastIndexOf('\n') + 1);
            const m = line.match(/^(\s*)([-*]) (.*)$/);
            if (m && el.selectionStart === el.selectionEnd) {
                e.preventDefault();
                const after = el.value.slice(el.selectionEnd);
                let next, caret;
                if (!m[3]) { // empty bullet ends the list
                    next = before.slice(0, before.length - line.length) + after.replace(/^/, '');
                    caret = before.length - line.length;
                } else {
                    const ins = `\n${m[1]}${m[2]} `;
                    next = before + ins + after;
                    caret = before.length + ins.length;
                }
                el.value = next;
                el.setSelectionRange(caret, caret);
                onInput(next);
            }
        }
    };

    return (
        <div class="md">
            <div class="md-toolbar" role="toolbar" aria-label={`${label} formatting`}>
                {TOOLS.map(([kind, title, icon]) => (
                    <button type="button" class="tool-btn" title={title} aria-label={icon.startsWith('H') ? `${icon} ${title.toLowerCase()}` : title} onMouseDown={e => e.preventDefault()} onClick={() => apply(kind)}>
                        {icon.startsWith('H') ? <span class="tool-text">{icon}</span> : <Icon name={icon} size={15} />}
                    </button>
                ))}
            </div>
            <textarea ref={ref} id={id} class="md-text" value={value ?? ''} spellcheck="true"
                placeholder={placeholder}
                onInput={e => onInput(e.currentTarget.value)} onKeyDown={onKeyDown} />
        </div>
    );
}
