// Form widgets used by the item editor. All are controlled by the store; none keep their own copy of the data.
import { useRef, useState, useLayoutEffect, useEffect } from 'preact/hooks';
import { Icon } from '../icons.jsx';

let uid = 0;
export const useUid = () => {
    const ref = useRef(null);
    if (ref.current === null) ref.current = `f${++uid}`;
    return ref.current;
};

export function Field({ path, label, hint, aside, children, wide }) {
    const id = useUid();
    return (
        <div class={'field' + (wide ? ' field-wide' : '')} data-field={path}>
            {label && (
                <div class="field-head">
                    <label for={id}>{label}</label>
                    {aside && <span class="field-aside">{aside}</span>}
                </div>
            )}
            {typeof children === 'function' ? children(id) : children}
            {hint && <p class="hint">{hint}</p>}
        </div>
    );
}

export function TextInput({ value, onInput, id, class: cls, ...rest }) {
    return <input id={id} class={'input ' + (cls || '')} type="text" value={value ?? ''}
        onInput={e => onInput(e.currentTarget.value)} autocomplete="off" spellcheck={rest.spellcheck ?? true} {...rest} />;
}

export function TextArea({ value, onInput, id, rows = 2, class: cls, ...rest }) {
    const ref = useRef(null);
    const fit = () => {
        const el = ref.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = el.scrollHeight + 2 + 'px';
    };
    useLayoutEffect(fit, [value]);
    useEffect(() => { document.fonts?.ready.then(fit); }, []);
    return <textarea ref={ref} id={id} class={'input textarea ' + (cls || '')} rows={rows} value={value ?? ''}
        onInput={e => onInput(e.currentTarget.value)} {...rest} />;
}

export function Select({ value, onChange, options, id, placeholder = 'Not set', label }) {
    return (
        <select id={id} class="input select" aria-label={label} value={value ?? ''} onChange={e => onChange(e.currentTarget.value)}>
            <option value="">{placeholder}</option>
            {options.map(o => <option value={o.value ?? o}>{o.label ?? o}</option>)}
        </select>
    );
}

export function Switch({ checked, onChange, label, description, disabled }) {
    return (
        <button type="button" class="switch" role="switch" aria-checked={checked ? 'true' : 'false'} disabled={disabled}
            onClick={() => onChange(!checked)}>
            <span class="switch-track"><span class="switch-thumb" /></span>
            <span class="switch-text">
                <span class="switch-label">{label}</span>
                {description && <span class="switch-desc">{description}</span>}
            </span>
        </button>
    );
}

export function ChipToggles({ value = [], options, onChange, label }) {
    const toggle = id => onChange(value.includes(id) ? value.filter(v => v !== id) : [...value, id]);
    return (
        <div class="chip-toggles" role="group" aria-label={label}>
            {options.map(o => {
                const on = value.includes(o.id);
                return (
                    <button type="button" class="chip-toggle" aria-pressed={on ? 'true' : 'false'} onClick={() => toggle(o.id)}>
                        {on && <Icon name="check" size={13} />}
                        {o.label}
                        {on && value.length > 1 && value[0] === o.id && <span class="chip-primary">primary</span>}
                    </button>
                );
            })}
        </div>
    );
}

/** Tags: Enter or comma adds, Backspace on an empty box removes the last, suggestions drop down. */
export function TokenInput({ value = [], onChange, suggestions = [], id, label }) {
    const [text, setText] = useState('');
    const [open, setOpen] = useState(false);
    const [hi, setHi] = useState(0);
    const [arrowed, setArrowed] = useState(false); // only a suggestion she moved to counts on Enter
    const inputRef = useRef(null);
    const listId = (id || 'tok') + '-list';

    // Suggestions appear once she types, prefix matches first.
    const needle = text.trim().toLowerCase();
    const matches = needle ? suggestions
        .filter(s => !value.includes(s) && s.toLowerCase().includes(needle))
        .sort((a, b) => (b.toLowerCase().startsWith(needle) ? 1 : 0) - (a.toLowerCase().startsWith(needle) ? 1 : 0))
        .slice(0, 8) : [];

    const add = raw => {
        const v = raw.trim();
        if (v && !value.includes(v)) onChange([...value, v]);
        setText('');
        setHi(0);
        setArrowed(false);
    };
    const remove = v => onChange(value.filter(x => x !== v));

    const onKey = e => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            if (open && arrowed && matches[hi] && text.trim()) add(matches[hi]); else add(text);
        } else if (e.key === 'Backspace' && !text && value.length) {
            remove(value[value.length - 1]);
        } else if (e.key === 'ArrowDown' && matches.length) {
            e.preventDefault(); setOpen(true); setArrowed(true); setHi(h => (arrowed ? h + 1 : 0) % matches.length);
        } else if (e.key === 'ArrowUp' && matches.length) {
            e.preventDefault(); setArrowed(true); setHi(h => (h - 1 + matches.length) % matches.length);
        } else if (e.key === 'Escape' && open) {
            e.stopPropagation(); setOpen(false);
        }
    };

    return (
        <div class="tokens" onClick={() => inputRef.current?.focus()}>
            {value.map(v => (
                <span class="token" key={v}>
                    {v}
                    <button type="button" class="token-x" aria-label={`Remove ${v}`} onClick={e => { e.stopPropagation(); remove(v); }}>
                        <Icon name="x" size={12} />
                    </button>
                </span>
            ))}
            <input id={id} ref={inputRef} class="token-input" type="text" value={text} autocomplete="off"
                role="combobox" aria-expanded={open && matches.length ? 'true' : 'false'} aria-controls={listId} aria-autocomplete="list"
                aria-label={label}
                placeholder={value.length ? '' : 'Type and press Enter'}
                onInput={e => { setText(e.currentTarget.value); setOpen(true); setHi(0); setArrowed(false); }}
                onKeyDown={onKey}
                onFocus={() => setOpen(true)}
                onBlur={() => { setOpen(false); if (text.trim()) add(text); }} />
            {open && matches.length > 0 && (
                <ul class="suggest" id={listId} role="listbox">
                    {matches.map((m, i) => (
                        <li role="option" aria-selected={arrowed && i === hi ? 'true' : 'false'} class={arrowed && i === hi ? 'on' : ''}
                            onMouseDown={e => { e.preventDefault(); add(m); }}>{m}</li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/**
 * Reorderable list of rows. `renderRow(item, index, update, focusProps)` draws one row.
 * Rows are keyed by a stable id kept in step with every add, remove and move.
 */
export function ListEditor({ items = [], onChange, renderRow, makeItem, addLabel = 'Add', itemLabel = 'item', onEnterAdd }) {
    const keys = useRef([]);
    const seq = useRef(0);
    const drag = useRef(null);
    const [over, setOver] = useState(null);
    const rows = useRef(null);
    while (keys.current.length < items.length) keys.current.push(++seq.current);
    if (keys.current.length > items.length) keys.current.length = items.length;

    // Focus waits for the render that creates or moves the row.
    const wantFocus = useRef(null);
    const focusRow = i => { wantFocus.current = i; };
    useLayoutEffect(() => {
        if (wantFocus.current === null) return;
        rows.current?.querySelectorAll('.list-row')[wantFocus.current]?.querySelector('input,textarea')?.focus();
        wantFocus.current = null;
    });
    const commit = next => onChange(next);
    const update = (i, v) => commit(items.map((x, j) => (j === i ? v : x)));
    const remove = i => { keys.current.splice(i, 1); commit(items.filter((_, j) => j !== i)); };
    const add = (at = items.length) => {
        const next = items.slice();
        next.splice(at, 0, makeItem());
        keys.current.splice(at, 0, ++seq.current);
        commit(next);
        focusRow(at);
    };
    const move = (from, to) => {
        if (to < 0 || to >= items.length || from === to) return;
        const next = items.slice();
        const [x] = next.splice(from, 1);
        next.splice(to, 0, x);
        const [k] = keys.current.splice(from, 1);
        keys.current.splice(to, 0, k);
        commit(next);
    };

    const rowKeys = (i) => e => {
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            const to = i + (e.key === 'ArrowUp' ? -1 : 1);
            move(i, to);
            focusRow(to);
        } else if (e.key === 'Enter' && !e.shiftKey && onEnterAdd && e.target.tagName !== 'BUTTON') {
            e.preventDefault();
            add(i + 1);
        } else if (e.key === 'Backspace' && onEnterAdd && e.target.value === '' && items.length > 0) {
            e.preventDefault();
            remove(i);
            focusRow(Math.max(0, i - 1));
        }
    };

    return (
        <div class="list-editor" ref={rows}>
            {items.map((item, i) => (
                <div class={'list-row' + (over === i ? ' drop-target' : '')} key={keys.current[i]}
                    onDragOver={e => { if (drag.current !== null) { e.preventDefault(); setOver(i); } }}
                    onDragLeave={() => setOver(null)}
                    onDrop={e => { e.preventDefault(); setOver(null); if (drag.current !== null) move(drag.current, i); drag.current = null; }}
                    onKeyDown={rowKeys(i)}>
                    <span class="grip" draggable="true" aria-hidden="true" title="Drag to reorder (or Alt+Up / Alt+Down)"
                        onDragStart={e => { drag.current = i; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); }}
                        onDragEnd={() => { drag.current = null; setOver(null); }}>
                        <Icon name="grip" size={14} />
                    </span>
                    <div class="list-cell">{renderRow(item, i, v => update(i, v))}</div>
                    <button type="button" class="icon-btn" aria-label={`Remove ${itemLabel} ${i + 1}`} onClick={() => remove(i)}>
                        <Icon name="x" size={14} />
                    </button>
                </div>
            ))}
            <button type="button" class="link-btn add-row" onClick={() => add()}>
                <Icon name="plus" size={14} /> {addLabel}
            </button>
        </div>
    );
}
