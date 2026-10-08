import { getCollection, type CollectionEntry } from 'astro:content';
import type { ImageMetadata } from 'astro';
import { DISCIPLINES } from '../content.config';
import resumeData from '../data/resumes.json';
import mediaMetaData from '../data/media-meta.json';
import {
    normalizeMedia, isVideo, imageGlobKey, publicMediaUrl, posterSrcFor, mediaRel,
} from './media.mjs';
import fs from 'node:fs';
import path from 'node:path';

export type Discipline = (typeof DISCIPLINES)[number];
export type Project = CollectionEntry<'projects'>;
export type Award = CollectionEntry<'awards'>;

export { isVideo };

export const DISCIPLINE_LABELS: Record<Discipline, string> = {
    design: 'Design',
    programming: 'Programming',
    production: 'Production',
};

// src/content/ should only ever hold published items, but filter anyway so a
// hand-copied private file can't reach the build.
const isPublic = (e: { data: { visibility: string } }) => e.data.visibility === 'public';
const byOrder  = (a: { data: { order: number } }, b: { data: { order: number } }) => a.data.order - b.data.order;

export async function getProjects() {
    return (await getCollection('projects', isPublic)).sort(byOrder);
}
export async function getExperience() {
    return (await getCollection('experience', isPublic)).sort(byOrder);
}
export async function getAwards() {
    return (await getCollection('awards', isPublic)).sort(byOrder);
}
export async function getCourses() {
    return (await getCollection('courses', isPublic)).sort(byOrder);
}
export async function getSkills() {
    return (await getCollection('skills', isPublic)).sort(byOrder);
}

// ── Media ─────────────────────────────────────────────────────────────────

const images = import.meta.glob<{ default: ImageMetadata }>(
    '/src/assets/media/**/*.{webp,png,jpg,jpeg,avif}',
    { eager: true },
);

/** Build-time ImageMetadata for a `/vault-media/...` image ref (undefined if it isn't an optimizable image). */
export function resolveImage(src?: string | null): ImageMetadata | undefined {
    const key = src && imageGlobKey(src);
    return key ? images[key]?.default : undefined;
}

export type VideoMeta = { bytes: number; width: number; height: number; duration: number | null };
const mediaMeta = mediaMetaData as Record<string, VideoMeta>;

/** Size/dimensions/duration of a published video (written by publish). */
export const videoMeta = (src: string): VideoMeta | undefined => mediaMeta[src];

/** Loops silently when short and light enough (see spec: <= 12 s and <= 1.5 MB), otherwise click-to-play. */
export function canLoop(src: string) {
    const m = videoMeta(src);
    return !!m && m.duration != null && m.duration <= 12 && m.bytes <= 1.5 * 1024 * 1024;
}

export type MediaItem = ReturnType<typeof normalizeMedia>[number] & {
    /** Optimizable image: pass to <Picture>. Undefined for videos. */
    image?: ImageMetadata;
    /** Video file URL (served from public/media). Undefined for images. */
    url?: string;
    /** Video poster: URL under public/media plus dimensions when known. */
    posterUrl?: string;
    meta?: VideoMeta;
};

function resolveMedia(item: ReturnType<typeof normalizeMedia>[number]): MediaItem {
    if (!item.video) return { ...item, image: resolveImage(item.src) };
    const poster = posterSrcFor(item);
    const rel = poster && mediaRel(poster);
    return {
        ...item,
        url: publicMediaUrl(item.src),
        posterUrl: rel && fs.existsSync(path.join('public/media', rel)) ? publicMediaUrl(poster!) : undefined,
        meta: videoMeta(item.src),
    };
}

/**
 * A project's visible media, normalized and resolved: cover first, then the
 * gallery in her order. Throws on an image that did not make it into
 * src/assets/media, so a broken ref fails the build instead of rendering blank.
 */
export function projectMedia(p: Project): MediaItem[] {
    const items = normalizeMedia(p.data.media, { cover: p.data.image }).filter(m => !m.hidden).map(resolveMedia);
    for (const m of items) {
        if (!m.video && !m.image) throw new Error(`${p.id}: image ${m.src} is not in src/assets/media (run publish)`);
    }
    return items;
}

/** The project's cover as an image: `image` if set, else the first gallery image. */
export function coverOf(p: Project): MediaItem | undefined {
    const items = projectMedia(p);
    return items.find(m => m.src === p.data.image) ?? items.find(m => !m.video);
}

/** First video in the gallery (for hero/loop use). */
export const firstVideo = (p: Project) => projectMedia(p).find(m => m.video);

/** Whether a project has anything visual to show (a blank card looks broken). */
export const hasVisual = (p: Project) => normalizeMedia(p.data.media, { cover: p.data.image }).some(m => !m.hidden);

// ── Selection helpers ─────────────────────────────────────────────────────

/** Featured projects, with ones matching `lens` pulled to the front (stable otherwise). */
export function featuredFor(projects: Project[], lens?: Discipline) {
    const featured = projects.filter(p => p.data.featured);
    if (!lens) return featured;
    const rank = (p: Project) => {
        const i = p.data.disciplines.indexOf(lens);
        return i < 0 ? 99 : i; // primary discipline (listed first) ranks highest
    };
    return [...featured].sort((a, b) => rank(a) - rank(b));
}

/**
 * Cards for Home and the /for/ pages: featured projects that have an image
 * (a blank card looks broken), topped up from the rest of the public list in
 * order so there are always `count` cards.
 */
export function cardProjects(projects: Project[], lens?: Discipline, count = 3) {
    const hasImage = (p: Project) => normalizeMedia(p.data.media, { cover: p.data.image }).some(m => !m.hidden && !m.video);
    const picked = featuredFor(projects, lens).filter(hasImage);
    for (const p of projects) {
        if (picked.length >= count) break;
        if (!picked.includes(p) && hasImage(p) && (!lens || p.data.disciplines.includes(lens))) picked.push(p);
    }
    return picked.slice(0, Math.max(count, picked.length));
}

// ── Resumes ───────────────────────────────────────────────────────────────

export type ResumePage = { src: string; width: number; height: number };
export type Resume = {
    id: string; label: string; lens?: Discipline;
    /** PDF download URL */
    file: string;
    pages: ResumePage[];
};
export type ResumeLayer = {
    pages: {
        text: { s: string; x: number; y: number; w: number; h: number }[];
        links: { url: string; x: number; y: number; w: number; h: number }[];
    }[];
};

/** Live resumes from src/data/resumes.json (written by publish), in vault order (first = default). */
export const RESUMES = resumeData as Resume[];
if (!RESUMES.length) throw new Error('resumes.json: no live resume (mark one live in the vault and publish)');
for (const r of RESUMES) {
    // Fail the build rather than ship a viewer pointing at a missing PDF
    if (!fs.existsSync(path.join('public', r.file))) throw new Error(`resumes.json: ${r.file} not found in public/`);
}

/** The resume for a recruiter lens, falling back to the default. */
export function resumeFor(lens?: Discipline): Resume {
    return RESUMES.find(r => lens && r.lens === lens) ?? RESUMES[0];
}

const layers = import.meta.glob<{ default: ResumeLayer }>('../data/resume-layers/*.json', { eager: true });

/** Selectable-text and link hotspots (percent of page) for a resume, from publish's prerender. */
export function resumeLayer(id: string): ResumeLayer | undefined {
    return layers[`../data/resume-layers/${id}.json`]?.default;
}
