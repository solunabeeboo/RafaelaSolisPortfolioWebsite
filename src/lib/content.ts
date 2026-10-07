import { getCollection, type CollectionEntry } from 'astro:content';
import { DISCIPLINES } from '../content.config';
import resumeData from '../data/resumes.json';
import fs from 'node:fs';
import path from 'node:path';

export type Discipline = (typeof DISCIPLINES)[number];
export type Project = CollectionEntry<'projects'>;

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
export async function getCourses() {
    return (await getCollection('courses', isPublic)).sort(byOrder);
}
export async function getSkills() {
    return (await getCollection('skills', isPublic)).sort(byOrder);
}

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

export const isVideo = (src: string) => /\.(mp4|webm|ogg)$/i.test(src);

/** Hero image first, then videos, then the remaining images (the carousel's order). */
export function projectMedia(p: Project) {
    const rest = p.data.media.filter(m => m !== p.data.image);
    return [
        ...(p.data.image ? [p.data.image] : []),
        ...rest.filter(isVideo),
        ...rest.filter(m => !isVideo(m)),
    ];
}

type Resume = { id: string; label: string; file: string; enabled: boolean; discipline?: Discipline };

/** Enabled resumes from src/data/resumes.json, in file order (first = default). */
export const RESUMES: Resume[] = (resumeData.resumes as Resume[]).filter(r => r.enabled);
if (!RESUMES.length) throw new Error("resumes.json: enable at least one resume");
for (const r of RESUMES) {
    // Fail the build rather than ship a viewer pointing at a missing PDF
    if (!fs.existsSync(path.join("public", r.file))) throw new Error(`resumes.json: ${r.file} not found in public/`);
}

/** The resume for a recruiter lens, falling back to the default. */
export function resumeFor(lens?: Discipline): Resume {
    return RESUMES.find(r => lens && r.discipline === lens) ?? RESUMES[0];
}
