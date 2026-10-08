import { Icon } from '../icons.jsx';
import { ui } from '../store.js';
import { Modal } from './ui.jsx';

const ROWS = [
    ['Ctrl K', 'Search everything, run actions'],
    ['C or Alt C', 'Quick capture (Alt C also works while typing)'],
    ['N', 'New item in this list'],
    ['/', 'Filter the list'],
    ['↑ ↓ or J K', 'Move through the list'],
    ['Enter / Esc', 'Open the editor wider / step back'],
    ['Alt ↑ ↓', 'Reorder the selected item or bullet'],
    ['Shift P', 'Switch the selected item between public and private'],
    ['G then P, E, W, C, K, R, S, I, A, N, M, T', 'Go to Projects, Experience, Awards, Courses, Skills, Résumés, Site text, Inbox, Attention, Notes, Media, Trash'],
    ['Ctrl \\', 'Show or hide the live preview'],
    ['Ctrl Z / Ctrl Shift Z', 'Undo or redo an edit, reorder, delete or rename (inside a text box it undoes typing)'],
    ['Ctrl S', 'Save now'],
    ['Ctrl Enter', 'Open the publish panel'],
    ['Ctrl B / Ctrl I', 'Bold or italic in the case study'],
    ['?', 'This list'],
];

export function Help() {
    const onClose = () => { ui.help.value = false; };
    return (
        <Modal title="Keyboard shortcuts" onClose={onClose} width={560}>
            <div class="modal-body">
                <div class="modal-head">
                    <h2 class="modal-title">Keyboard shortcuts</h2>
                    <button type="button" class="icon-btn" aria-label="Close" onClick={onClose}><Icon name="x" size={16} /></button>
                </div>
                <dl class="shortcuts">
                    {ROWS.map(([k, d]) => <><dt><kbd>{k}</kbd></dt><dd>{d}</dd></>)}
                </dl>
                <p class="hint">Single-letter shortcuts work when you are not typing in a box. Edits save on their own.</p>
            </div>
        </Modal>
    );
}
