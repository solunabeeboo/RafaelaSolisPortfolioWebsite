import { defineCollection, z } from 'astro:content';
import { glob, file } from 'astro/loaders';

/*
 * Everything here is loaded from src/content/, which is the PUBLIC snapshot
 * written by `npm run publish` (scripts/vault.mjs). The full private vault
 * lives in vault/ (gitignored, its own private repo) and is never read by
 * the build directly. Edit the vault, then publish.
 */

export const DISCIPLINES = ['design', 'programming', 'production'] as const;
const discipline = z.enum(DISCIPLINES);

// Shared by every vault item. Default is private: forgetting to set it
// keeps an item out of the public site rather than leaking it.
const vaultFields = {
    visibility: z.enum(['public', 'private']).default('private'),
    order:      z.number().default(999),
    disciplines: z.array(discipline).default([]),
    /** Notes to self. Shown in /admin, never rendered on the public site. */
    todo:       z.array(z.string()).default([]),
};

const projects = defineCollection({
    loader: glob({ pattern: '*.md', base: './src/content/projects' }),
    schema: z.object({
        ...vaultFields,
        title:        z.string(),
        hook:         z.string(),
        featured:     z.boolean().default(false),
        studio:       z.string().optional(),
        role:         z.string().optional(),
        team:         z.string().optional(),
        engine:       z.string().optional(),
        duration:     z.string().optional(),
        status:       z.string().optional(),
        image:        z.string().optional(),
        media:        z.array(z.string()).default([]),
        links:        z.array(z.object({ label: z.string(), url: z.string() })).default([]),
        embed:        z.object({ type: z.enum(['game', 'widget']), url: z.string() }).optional(),
        tags:         z.array(z.string()).default([]),
        contribution: z.array(z.string()).default([]),
    }),
});

const experience = defineCollection({
    loader: glob({ pattern: '*.md', base: './src/content/experience' }),
    schema: z.object({
        ...vaultFields,
        title:    z.string(),
        org:      z.string(),
        location: z.string().optional(),
        start:    z.string(),
        end:      z.string().default('Present'),
        bullets:  z.array(z.string()).default([]),
    }),
});

const courses = defineCollection({
    loader: file('./src/content/courses.json'),
    schema: z.object({ ...vaultFields, name: z.string() }),
});

const skills = defineCollection({
    loader: file('./src/content/skills.json'),
    schema: z.object({
        ...vaultFields,
        name:  z.string(),
        wide:  z.boolean().default(false),
        items: z.array(z.string()),
    }),
});

export const collections = { projects, experience, courses, skills };
