#!/usr/bin/env node
/**
 * Command-line access to the vault (the Vault app does the same through its server).
 *
 *   npm run publish                          write the public snapshot into the site repo
 *   npm run publish -- --dry-run             show what would change, write nothing
 *   node scripts/vault.mjs new <type> "Title"   start a new private item
 *   node scripts/vault.mjs check             readiness report for every item
 *
 * Set VAULT_DIR to use a vault other than ./vault.
 */
import { loadAll, createItem, previewPublish, publish, ITEM_TYPES, VAULT_DIR } from './vault-lib.mjs';

const [cmd, ...args] = process.argv.slice(2);

const line = (label, items) => items.length && console.log(`${label}\n${items.map(i => `  ${i}`).join('\n')}`);

try {
    if (cmd === 'publish') {
        const dry = args.includes('--dry-run');
        const result = dry
            ? { ...previewPublish(), written: [], removed: [], counts: null }
            : await publish({ onStep: (name, detail) => console.log(`- ${detail}`) });
        line(dry ? 'Would change:' : 'Changed:', result.changes.map(c => `${c.change} ${c.type}/${c.id}`));
        line('Skipped (fix these first):', result.skipped.map(s => `${s.type}/${s.id}: ${s.errors.map(e => e.msg).join('; ')}`));
        line('Warnings:', result.warnings.map(w => `${w.type}/${w.id}: ${w.warnings.length}`));
        line('Resume problems:', result.resumeErrors ?? []);
        if (!dry) {
            console.log('Published:', result.counts);
            line('Resumes:', result.resumes.map(r => `${r.id}: ${r.pages} page(s) (${r.renderer})`));
            console.log(`${result.written.length} file(s) written, ${result.removed.length} removed.`);
            line('Could not remove:', result.failed);
        }
    } else if (cmd === 'new') {
        const [type, ...title] = args;
        if (!ITEM_TYPES.includes(type)) throw new Error(`Type must be one of: ${ITEM_TYPES.join(', ')}`);
        const item = createItem(type, { title: title.join(' ') });
        console.log(`Created ${type}/${item.id} (private)`);
    } else if (cmd === 'check') {
        const { collections, broken, siteReadiness } = loadAll();
        for (const [type, items] of Object.entries(collections)) {
            for (const it of items) {
                const { errors, warnings } = it.readiness;
                if (errors.length || warnings.length) {
                    console.log(`${type}/${it.id}`);
                    errors.forEach(e => console.log(`  error    ${e.field}: ${e.msg}`));
                    warnings.forEach(w => console.log(`  warning  ${w.field}: ${w.msg}`));
                }
            }
        }
        [...siteReadiness.errors, ...siteReadiness.warnings].forEach(w => console.log(`site: ${w.field}: ${w.msg}`));
        broken.forEach(b => console.log(`BROKEN ${b.file}: ${b.error}`));
    } else {
        console.log(`Vault: ${VAULT_DIR}\nUsage: publish [--dry-run] | new <type> "Title" | check`);
        process.exit(1);
    }
} catch (e) {
    console.error(e.message);
    process.exit(1);
}
