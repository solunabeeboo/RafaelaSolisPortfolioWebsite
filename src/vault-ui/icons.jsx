// Simple stroke icons (24px grid), decorative unless the caller labels them.
const PATHS = {
    inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z',
    alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
    projects: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    experience: 'M3 8h18v11H3zM9 8V5h6v3M3 13h18',
    awards: 'M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8.2 13.9 7 22l5-3 5 3-1.2-8.1',
    courses: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21V5M9 7h6',
    skills: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.7 2.7-2.3-.7-.7-2.3z',
    resumes: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7',
    site: 'M4 5h16M4 10h16M4 15h10M4 20h7',
    notes: 'M5 3h14v18l-4-3-3 3-3-3-4 3zM9 8h6M9 12h6',
    media: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M9 9.5h.01',
    trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
    plus: 'M12 5v14M5 12h14',
    search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
    star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.2 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
    chevron: 'M9 6l6 6-6 6',
    chevronDown: 'M6 9l6 6 6-6',
    x: 'M6 6l12 12M18 6 6 18',
    grip: 'M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01',
    upload: 'M12 16V4M7 9l5-5 5 5M4 16v4h16v-4',
    undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
    history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
    panel: 'M3 4h18v16H3zM13 4v16',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
    check: 'M5 12l5 5 9-10',
    external: 'M14 4h6v6M20 4 10 14M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
    play: 'M7 4.5v15l12-7.5z',
    up: 'M12 19V5M6 11l6-6 6 6',
    down: 'M12 5v14M6 13l6 6 6-6',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    bold: 'M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z',
    italic: 'M19 4h-9M14 20H5M15 4 9 20',
    list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
    quote: 'M5 17c0-4 1-7 4-9M13 17c0-4 1-7 4-9M4 17h5v-5H4zM12 17h5v-5h-5z',
    publish: 'M12 19V6M6 11l6-6 6 6M5 21h14',
    phone: 'M7 2h10a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM11 18h2',
    desktop: 'M3 4h18v12H3zM8 20h8M12 16v4',
    logo: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM9 12h6',
    lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
    globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
    file: 'M6 3h9l4 4v14H6zM14 3v5h5',
    film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4',
    command: 'M9 9V6a3 3 0 1 0-3 3h3zm0 0h6m-6 0v6m6-6V6a3 3 0 1 1 3 3h-3zm0 0v6m0 0h3a3 3 0 1 1-3 3zm0 0H9m0 0v3a3 3 0 1 1-3-3z',
};

export function Icon({ name, size = 16, label, class: cls }) {
    return (
        <svg class={'icon ' + (cls || '')} width={size} height={size} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
            role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'}>
            <path d={PATHS[name] || PATHS.file} />
        </svg>
    );
}

export function StarFilled({ size = 16 }) {
    return (
        <svg class="icon" width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="currentColor"
            stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">
            <path d={PATHS.star} />
        </svg>
    );
}
