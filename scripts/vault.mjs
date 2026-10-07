#!/usr/bin/env node
/**
 * npm run publish   copy public vault items into src/content/ for the build
 * npm run vault:new -- "Project Title"   start a new private project from the template
 */
import { publish, createProject } from './vault-lib.mjs';

const [cmd, ...args] = process.argv.slice(2);

try {
    if (cmd === 'publish') {
        const { counts, missing } = publish();
        console.log('Published public items:', counts);
        if (missing.length) console.warn('Missing media (not copied):', missing);
    } else if (cmd === 'new') {
        const { file } = createProject(args.join(' '));
        console.log('Created', file);
    } else {
        console.log('Usage: node scripts/vault.mjs publish | new "Title"');
        process.exit(1);
    }
} catch (e) {
    console.error(e.message);
    process.exit(1);
}
