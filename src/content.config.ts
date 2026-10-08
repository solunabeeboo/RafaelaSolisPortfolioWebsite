import { defineCollection } from 'astro:content';
import { glob, file } from 'astro/loaders';
import { publicSchema, DISCIPLINES as DISCIPLINE_LIST } from './lib/schema.mjs';

/*
 * Everything here is loaded from src/content/, the PUBLIC snapshot written by
 * `npm run publish`. The private vault (vault/, its own git repo) is never read
 * by the build. Schemas live in src/lib/schema.mjs, shared with the vault tools.
 */

export const DISCIPLINES = DISCIPLINE_LIST as readonly ['design', 'programming', 'production'];

const md = (name: string) => glob({ pattern: '*.md', base: `./src/content/${name}` });

export const collections = {
    projects:   defineCollection({ loader: md('projects'),   schema: publicSchema('projects') }),
    experience: defineCollection({ loader: md('experience'), schema: publicSchema('experience') }),
    awards:     defineCollection({ loader: md('awards'),     schema: publicSchema('awards') }),
    courses:    defineCollection({ loader: file('./src/content/courses.json'), schema: publicSchema('courses') }),
    skills:     defineCollection({ loader: file('./src/content/skills.json'),  schema: publicSchema('skills') }),
};
