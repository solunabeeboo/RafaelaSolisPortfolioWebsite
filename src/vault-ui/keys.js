// App-wide keyboard shortcuts. Single letters only fire when she is not typing and no dialog is open.
import {
    ui, route, navigate, flushAll, undo, redo, toast,
} from './store.js';
import { TYPES } from './meta.js';

const GO = {
    i: '/inbox', a: '/attention', p: '/projects', e: '/experience', w: '/awards', c: '/courses', k: '/skills',
    r: '/resumes', s: '/site', n: '/notes', m: '/media', t: '/trash',
};
const LIST_VIEWS = new Set(Object.keys(TYPES));

const isTyping = el =>
    el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && !(el.tagName === 'INPUT' && ['checkbox', 'radio', 'button'].includes(el.type)));

const modalOpen = () => ui.palette.value || ui.publish.value || ui.capture.value || ui.help.value || ui.history.value || !!document.querySelector('.scrim');

let goPending = 0;

// The list may be hidden until the layout collapses, so focus after the next render.
const focusList = () => requestAnimationFrame(() => document.querySelector('.rows')?.focus());

export function installKeys() {
    window.addEventListener('keydown', e => {
        const mod = e.ctrlKey || e.metaKey;
        const k = e.key;

        if (mod && k.toLowerCase() === 'k') { e.preventDefault(); ui.palette.value = !ui.palette.value; return; }
        if (e.altKey && !mod && e.code === 'KeyC') { e.preventDefault(); ui.capture.value = true; return; }
        if (mod && k === 's') { e.preventDefault(); flushAll(); toast('Saved'); return; }
        if (mod && k === 'Enter') { e.preventDefault(); ui.publish.value = true; return; }
        if (mod && k === '\\') { e.preventDefault(); ui.preview.value = !ui.preview.value; return; }

        if (mod && !isTyping(e.target) && !modalOpen()) {
            if (k.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
            if (k.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
        }

        if (modalOpen() || isTyping(e.target) || mod || e.altKey) return;

        if (goPending && Date.now() - goPending < 1200) {
            goPending = 0;
            if (GO[k]) { e.preventDefault(); navigate(GO[k]); ui.expanded.value = false; }
            return;
        }

        const view = route.value.view;
        switch (k) {
            case 'c': e.preventDefault(); ui.capture.value = true; break;
            case 'g': goPending = Date.now(); break;
            case '/': if (LIST_VIEWS.has(view)) { e.preventDefault(); window.dispatchEvent(new Event('vault:focus-search')); } break;
            case 'n': if (LIST_VIEWS.has(view) && view !== 'inbox') { e.preventDefault(); window.dispatchEvent(new Event('vault:new-item')); } break;
            case '?': ui.help.value = true; break;
            case 'j': case 'k': case 'ArrowDown': case 'ArrowUp': {
                const list = document.querySelector('.rows');
                if (list && e.target === document.body) {
                    e.preventDefault();
                    list.focus();
                    list.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
                }
                break;
            }
            case 'Escape':
                ui.expanded.value = false;
                focusList();
                break;
        }
    });

    // Esc inside the editor returns to the list.
    window.addEventListener('keydown', e => {
        if (e.key !== 'Escape' || modalOpen() || e.defaultPrevented) return;
        if (isTyping(e.target) && e.target.closest('.editor-col')) {
            e.target.blur();
            ui.expanded.value = false;
            focusList();
        }
    });
}

