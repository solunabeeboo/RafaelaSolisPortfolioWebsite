// Presentation helpers shared by the public pages and the vault preview.
// Read-only: nothing here changes content.
import siteJson from '../data/site.json';
import { normalizeMedia, posterSrcFor, mediaRel } from './media.mjs';
import type { MediaItem } from './content';

export const site = siteJson as any;

type ContactNode = { id: string; label: string; handle: string; href: string };
const nodes: ContactNode[] = site.contact?.nodes ?? [];
export const contactNode = (id: string) => nodes.find(n => n.id === id);

export const EMAIL = contactNode('email')?.handle ?? '';

/** Contact links shown in the footer and on /contact/ (email is handled separately). */
export const SOCIAL = ['linkedin', 'github', 'itch', 'bluesky']
    .map(contactNode)
    .filter((n): n is ContactNode => !!n);

const KIND_LABELS: Record<string, string> = {
    studio: 'Studio project',
    team: 'Team project',
    solo: 'Solo project',
    jam: 'Game jam',
    class: 'Class project',
    mod: 'Mod',
    tool: 'Tool',
};
export const kindLabel = (kind?: string) => (kind ? KIND_LABELS[kind] : undefined);

/** Minimal shape the folder and case-study components need (collection entry or parsed vault item). */
export type ProjectLike = { id: string; data: Record<string, any> };

export type Fact = { label: string; value: string };

/** Labelled facts in a fixed order; empty fields are left out, never filled in. */
export function projectFacts(d: Record<string, any>): Fact[] {
    const rows: [string, string | undefined][] = [
        ['Role', d.role],
        ['Studio', d.studio],
        ['Type', kindLabel(d.kind)],
        ['Team', d.team],
        ['Engine', d.engine],
        ['Duration', d.duration],
        ['Year', d.year],
        ['Platforms', d.platforms?.length ? d.platforms.join(', ') : undefined],
        ['Status', d.status],
    ];
    return rows.filter((r): r is [string, string] => !!r[1]?.trim()).map(([label, value]) => ({ label, value }));
}

/** Short context for archive rows: the studio if she gave one, else the kind, else the team line. */
export const contextOf = (d: Record<string, any>) => d.studio || kindLabel(d.kind) || d.team || '';

/** The link to "play" the project, when one of her links says so. */
export const playLink = (links: { label: string; url: string }[] = []) =>
    links.find(l => /\bplay\b/i.test(l.label));

export const isExternal = (url: string) => /^https?:\/\//i.test(url);

/** Whether a link points back into this site (rendered without an external-link marker). */
export const isInternal = (url: string) => url.startsWith('/') && !url.startsWith('//');

// ── Vault preview media ───────────────────────────────────────────────────
// Previewed projects are not published, so their files are served by the vault
// server instead of src/assets/media. The server runs next to the dev server.
const VAULT_ORIGIN = (typeof process !== 'undefined' && process.env.VAULT_ORIGIN) || 'http://127.0.0.1:4319';

export function previewMedia(data: Record<string, any>): MediaItem[] {
    return normalizeMedia(data.media, { cover: data.image })
        .filter((m: any) => !m.hidden)
        .map((m: any) => {
            const remote = (src: string) => VAULT_ORIGIN + src;
            if (!m.video) return { ...m, rawUrl: remote(m.src) } as unknown as MediaItem;
            const poster = posterSrcFor(m);
            return {
                ...m,
                url: remote(m.src),
                posterUrl: poster && mediaRel(poster) ? remote(poster) : undefined,
            } as MediaItem;
        });
}

const STATIC_PAGES = new Set(['/', '/projects/', '/about/', '/resume/', '/contact/']);

/**
 * Her links, minus internal ones that do not resolve to a page on this site
 * (a removed demo page must not leave a dead link behind).
 */
export function liveLinks(links: { label: string; url: string }[] = [], projectIds: string[] = []) {
    const pages = new Set([...STATIC_PAGES, ...projectIds.map(id => `/projects/${id}/`)]);
    return links.filter(l => !isInternal(l.url) || pages.has(l.url));
}
