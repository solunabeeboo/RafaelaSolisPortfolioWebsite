/**
 * Shared content schemas. Plain JS so both the Astro build (content.config.ts)
 * and the Node scripts (vault, publish, tests) validate against one definition.
 *
 * The *full* shapes describe vault files (including vault-only keys such as
 * `todo`). `publicSchema(type)` describes what reaches src/content: the same
 * keys minus anything vault-only.
 */
import { z } from 'astro/zod';

export { z };

export const DISCIPLINES = ['design', 'programming', 'production'];
export const KINDS = ['studio', 'team', 'solo', 'jam', 'class', 'mod', 'tool'];

/** Top-level collections the vault knows about, and how each is stored. */
export const MD_TYPES = ['projects', 'experience', 'awards', 'notes', 'inbox'];
export const JSON_TYPES = ['courses', 'skills'];
export const ITEM_TYPES = [...MD_TYPES, ...JSON_TYPES];
/** Types that can ever reach the public site. Notes and inbox never do. */
export const PUBLISHABLE_TYPES = ['projects', 'experience', 'awards', 'courses', 'skills'];

const discipline = z.enum(DISCIPLINES);

/**
 * Text field that tolerates a hand-typed bare number (`year: 2025`, `team: 4`):
 * YAML reads those as numbers, but they mean text. Marked so `coerceScalars`
 * can normalise the same fields when files are read.
 */
const numToText = v => (typeof v === 'number' && Number.isFinite(v) ? String(v) : v);
const text = (inner = z.string()) => Object.assign(z.preprocess(numToText, inner), { looseText: true });
const req = () => text();
const opt = () => text(z.string().optional());
const link = z.object({ label: z.string(), url: z.string() });

// Default is private: forgetting to set it keeps an item off the public site.
const vaultFields = {
    visibility:  z.enum(['public', 'private']).default('private'),
    order:       z.number().default(999),
    disciplines: z.array(discipline).default([]),
    /** Notes to self. Vault-only: stripped on publish. */
    todo:        z.array(z.string()).default([]),
};

export const mediaItem = z.union([
    z.string(),
    z.object({
        src:     z.string(),
        alt:     z.string().optional(),
        caption: z.string().optional(),
        poster:  z.string().optional(),
        hidden:  z.boolean().optional(),
    }),
]);

export const shapes = {
    projects: {
        ...vaultFields,
        title:        req(),
        hook:         req(),
        featured:     z.boolean().default(false),
        year:         opt(),
        kind:         z.enum(KINDS).optional(),
        studio:       opt(),
        role:         opt(),
        team:         opt(),
        engine:       opt(),
        duration:     opt(),
        status:       opt(),
        platforms:    z.array(z.string()).default([]),
        credits:      z.array(z.object({ name: z.string(), role: z.string() })).default([]),
        image:        opt(),
        media:        z.array(mediaItem).default([]),
        links:        z.array(link).default([]),
        embed:        z.object({ type: z.enum(['game', 'widget']), url: z.string() }).optional(),
        tags:         z.array(z.string()).default([]),
        contribution: z.array(z.string()).default([]),
        // Optional structured case-study sections; the markdown body renders below.
        problem:      opt(),
        goal:         opt(),
        result:       opt(),
        reflection:   opt(),
        iterations:   z.array(z.object({ before: z.string(), finding: z.string(), change: z.string() })).default([]),
    },
    experience: {
        ...vaultFields,
        title:    req(),
        org:      req(),
        location: opt(),
        start:    req(),
        end:      text(z.string().default('Present')),
        year:     opt(),
        bullets:  z.array(z.string()).default([]),
    },
    awards: {
        ...vaultFields,
        title:  req(),
        issuer: opt(),
        date:   opt(),
        url:    opt(),
        /** Slug of the project this award relates to. */
        project: opt(),
    },
    courses: { ...vaultFields, name: z.string(), year: z.string().optional() },
    skills: {
        ...vaultFields,
        name:  req(),
        wide:  z.boolean().default(false),
        items: z.array(z.string()),
        year:  opt(),
    },
    // Private-only types: never published, so they carry no visibility/order.
    notes: {
        title: req(),
        url:   opt(),
        tags:  z.array(z.string()).default([]),
        order: z.number().default(999),
    },
    inbox: {
        title:       req(),
        kind:        z.enum(['project', 'award', 'note']).optional(),
        url:         opt(),
        attachments: z.array(z.string()).default([]),
        created:     opt(),
    },
};

export const schemas = Object.fromEntries(
    Object.entries(shapes).map(([type, shape]) => [type, z.object(shape)]),
);

/** Keys that may leave the vault for a type (everything in the shape except vault-only keys). */
const VAULT_ONLY = new Set(['todo']);
export const publicKeys = type => Object.keys(shapes[type]).filter(k => !VAULT_ONLY.has(k));

/** Schema for the published snapshot in src/content (no vault-only keys). */
export function publicSchema(type) {
    const shape = { ...shapes[type] };
    for (const k of VAULT_ONLY) delete shape[k];
    return z.object(shape);
}

export const projectSchema    = schemas.projects;
export const experienceSchema = schemas.experience;
export const awardSchema      = schemas.awards;
export const courseSchema     = schemas.courses;
export const skillSchema      = schemas.skills;

/** [{id,label,lens?,file,status}], file is vault-relative (`resumes/x.pdf`). */
export const resumeEntrySchema = z.object({
    id:     z.string(),
    label:  z.string(),
    lens:   discipline.optional(),
    file:   z.string(),
    status: z.enum(['draft', 'live']).default('draft'),
});
export const resumesSchema = z.array(resumeEntrySchema);

/** Turn bare numbers into text for the fields that accept either (see `text`). */
export function coerceScalars(type, data) {
    const shape = shapes[type];
    if (!shape || !data || typeof data !== 'object') return data;
    let out = data;
    for (const [k, v] of Object.entries(data)) {
        if (typeof v === 'number' && shape[k]?.looseText) {
            if (out === data) out = { ...data };
            out[k] = String(v);
        }
    }
    return out;
}
