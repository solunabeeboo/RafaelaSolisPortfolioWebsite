#!/usr/bin/env node
/**
 * npm run publish                         copy public vault items into src/content/
 * npm run vault:new -- "Project Title"    start a new private project
 * (Day to day, use http://localhost:4321/admin under `npm run dev`.)
 */
import { publish, createItem } from './vault-lib.mjs';

const [cmd, ...args] = process.argv.slice(2);

try {
    if (cmd === 'publish') {
        const { counts, missing } = publish();
        console.log('Published public items:', counts);
        if (missing.length) console.warn('Missing media (not copied):', missing);
    } else if (cmd === 'new') {
        const { id } = createItem('projects', args.join(' '));
        console.log(`Created vault/projects/${id}.md`);
    } else {
        console.log('Usage: node scripts/vault.mjs publish | new "Title"');
        process.exit(1);
    }
} catch (e) {
    console.error(e.message);
    process.exit(1);
}
