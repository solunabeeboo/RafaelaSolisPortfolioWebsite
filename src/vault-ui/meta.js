// Static facts about each item type, shared by the sidebar, library, editor and palette.

export const TYPES = {
    projects:   { label: 'Projects',   one: 'project',    icon: 'projects',   titleKey: 'title', publishable: true,  page: '/projects/' },
    experience: { label: 'Experience', one: 'experience', icon: 'experience', titleKey: 'title', publishable: true,  page: '/about/' },
    awards:     { label: 'Awards',     one: 'award',      icon: 'awards',     titleKey: 'title', publishable: true,  page: '/about/' },
    courses:    { label: 'Courses',    one: 'course',     icon: 'courses',    titleKey: 'name',  publishable: true,  page: '/about/' },
    skills:     { label: 'Skills',     one: 'skill group', icon: 'skills',    titleKey: 'name',  publishable: true,  page: '/about/' },
    notes:      { label: 'Notes',      one: 'note',       icon: 'notes',      titleKey: 'title', publishable: false },
    inbox:      { label: 'Inbox',      one: 'capture',    icon: 'inbox',      titleKey: 'title', publishable: false },
};

export const PORTFOLIO = ['projects', 'experience', 'awards', 'courses', 'skills'];
export const ARCHIVE = ['notes'];
export const DISCIPLINES = [
    { id: 'design', label: 'Design' },
    { id: 'programming', label: 'Programming' },
    { id: 'production', label: 'Production' },
];
export const KINDS = ['studio', 'team', 'solo', 'jam', 'class', 'mod', 'tool'];
export const KIND_LABELS = { studio: 'Studio', team: 'Team', solo: 'Solo', jam: 'Game jam', class: 'Class', mod: 'Mod', tool: 'Tool' };

/** Keys that must stay present (even when empty) so the file keeps validating as a draft. */
export const KEEP_EMPTY = new Set(['title', 'hook', 'org', 'start', 'name']);

export const titleOf = item => item.data[TYPES[item.type]?.titleKey] || item.data.title || item.data.name || item.id;

export const isVideo = src => /\.(mp4|webm|ogg|mov|m4v)(\?|#|$)/i.test(src || '');
export const posterFor = src => (src || '').replace(/\.[a-z0-9]+$/i, '.poster.webp');

/** Media entries are strings or objects; the editor works on objects and writes back the simplest form. */
export const mediaObj = e => (typeof e === 'string' ? { src: e } : { ...e });
export const mediaOut = o => {
    const out = { src: o.src };
    for (const k of ['alt', 'caption', 'poster']) if (o[k]) out[k] = o[k];
    if (o.hidden) out.hidden = true;
    return Object.keys(out).length === 1 ? out.src : out;
};

export function fmtBytes(n) {
    if (!n && n !== 0) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${Math.round(n / 1024)} KB`;
    return `${(n / 1048576).toFixed(1)} MB`;
}

export function ago(ms) {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    if (s < 86400 * 30) return `${Math.round(s / 86400)} d ago`;
    return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Subsequence fuzzy score: higher is better, -1 means no match. */
export function fuzzy(query, text) {
    const q = query.toLowerCase().trim();
    const t = (text || '').toLowerCase();
    if (!q) return 0;
    const at = t.indexOf(q);
    if (at >= 0) return 100 - Math.min(at, 50) + (at === 0 || t[at - 1] === ' ' ? 20 : 0);
    let ti = 0, score = 0, streak = 0;
    for (const ch of q) {
        const found = t.indexOf(ch, ti);
        if (found < 0) return -1;
        if (score > 0 && found - ti > 3) return -1; // letters must sit close together, not be scattered across a long text
        streak = found === ti ? streak + 1 : 0;
        score += 2 + streak * 2 - Math.min(found - ti, 5);
        ti = found + 1;
    }
    return Math.max(1, score);
}
