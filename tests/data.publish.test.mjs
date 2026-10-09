import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createVault, parseMd, stringifyMd, StaleError, ensureVaultIgnore } from '../scripts/vault-lib.mjs';
import { processVideo } from '../scripts/media.mjs';
import { findLeaks } from '../scripts/check-leaks.mjs';
import { tmpDir, write, writeImage, writeVideo, hasFfmpeg, SAMPLE_PDF } from './data-helpers.mjs';

const PROJECT_BODY = 'Visible text.\n\n<!-- private comment -->\n\nMore visible text.\n';

/** A small vault with public, private, and broken items, in a fresh temp dir. */
async function fixture({ video = false, broken = false } = {}) {
    const root = tmpDir('publish');
    const vaultDir = path.join(root, 'vault'), siteRoot = path.join(root, 'site');
    const m = p => path.join(vaultDir, 'media', p);
    await writeImage(m('projects/pub/cover.webp'));
    await writeImage(m('projects/pub/shot.webp'));
    await writeImage(m('projects/pub/hidden.webp'));
    await writeImage(m('projects/priv/secret.webp'));
    await writeImage(m('projects/unlinked/orphan.webp'));
    if (video) {
        const raw = path.join(root, 'raw.mp4');
        writeVideo(raw);
        await processVideo(raw, m('projects/pub/clip.mp4'));
    }

    const media = [
        '/vault-media/projects/pub/cover.webp',
        { src: '/vault-media/projects/pub/shot.webp', alt: 'A shot', caption: 'Caption' },
        { src: '/vault-media/projects/pub/hidden.webp', hidden: true },
        ...(video ? ['/vault-media/projects/pub/clip.mp4'] : []),
    ];
    write(path.join(vaultDir, 'projects/pub.md'), stringifyMd({
        title: 'Public project', hook: 'A hook.', visibility: 'public', featured: true, order: 1, year: '2025',
        image: '/vault-media/projects/pub/cover.webp', media,
        links: [{ label: 'Play', url: 'https://example.itch.io/x' }],
        todo: ['SECRET todo item'], _scratch: 'underscore key', mystery: 'not in the schema',
    }, PROJECT_BODY));
    write(path.join(vaultDir, 'projects/priv.md'), stringifyMd({
        title: 'Private project', hook: 'Hidden.', visibility: 'private', media: ['/vault-media/projects/priv/secret.webp'],
    }, 'Private body.\n'));
    write(path.join(vaultDir, 'projects/bad-media.md'), stringifyMd({
        title: 'Bad media', hook: 'h', visibility: 'public', media: ['/vault-media/projects/pub/missing.webp'],
    }, ''));
    write(path.join(vaultDir, 'projects/no-hook.md'), stringifyMd({ title: 'No hook', hook: '', visibility: 'public' }, ''));
    if (broken) write(path.join(vaultDir, 'projects/broken.md'), '---\ntitle: [unclosed\n---\nbody');
    write(path.join(vaultDir, 'experience/job.md'), stringifyMd({ title: 'Designer', org: 'Studio', start: '2024', visibility: 'public', todo: ['x'] }, ''));
    write(path.join(vaultDir, 'awards/prize.md'), stringifyMd({ title: 'Prize', issuer: 'Jam', visibility: 'public', project: 'pub' }, 'Won it.\n'));
    write(path.join(vaultDir, 'notes/note.md'), stringifyMd({ title: 'Private note' }, 'secret note body'));
    write(path.join(vaultDir, 'inbox/idea.md'), stringifyMd({ title: 'Idea' }, 'secret idea body'));
    write(path.join(vaultDir, 'courses.json'), JSON.stringify([
        { id: 'a', name: 'Public course', visibility: 'public', order: 1 },
        { id: 'b', name: 'Private course', visibility: 'private', order: 2 },
    ]));
    write(path.join(vaultDir, 'skills.json'), JSON.stringify([{ id: 's', name: 'Tools', visibility: 'public', order: 1, items: ['A'], todo: ['x'] }]));
    write(path.join(vaultDir, 'site.json'), JSON.stringify({ home: { tagline: 'Hello' } }));
    fs.mkdirSync(path.join(vaultDir, 'resumes'), { recursive: true });
    fs.copyFileSync(SAMPLE_PDF, path.join(vaultDir, 'resumes/design.pdf'));
    fs.copyFileSync(SAMPLE_PDF, path.join(vaultDir, 'resumes/draft.pdf'));
    write(path.join(vaultDir, 'resumes.json'), JSON.stringify([
        { id: 'design', label: 'Design', lens: 'design', file: 'resumes/design.pdf', status: 'live' },
        { id: 'draft', label: 'Draft', file: 'resumes/draft.pdf', status: 'draft' },
    ]));
    return { root, vaultDir, siteRoot, vault: createVault({ vaultDir, siteRoot }), site: p => path.join(siteRoot, p) };
}

const readText = f => fs.readFileSync(f, 'utf8');
const exists = f => fs.existsSync(f);

test('listing reports a broken file instead of crashing', async () => {
    const { vault } = await fixture({ broken: true });
    const { items, broken } = vault.listItems('projects');
    assert.equal(items.length, 4);
    assert.equal(broken.length, 1);
    assert.match(broken[0].file, /projects\/broken\.md/);
    assert.ok(vault.loadAll().broken.length >= 1);
});

test('publish writes only allowlisted fields and strips comments', async () => {
    const { vault, site } = await fixture();
    const result = await vault.publish();
    const text = readText(site('src/content/projects/pub.md'));
    assert.ok(!/todo|SECRET/i.test(text), 'todo leaked');
    assert.ok(!text.includes('_scratch') && !text.includes('mystery'), 'non-schema keys leaked');
    assert.ok(!text.includes('private comment'), 'html comment leaked');
    assert.ok(text.includes('Visible text.') && text.includes('More visible text.'));
    const { data, body } = parseMd(text);
    assert.equal(data.visibility, 'public');
    assert.equal(data.title, 'Public project');
    assert.equal(data.media.length, 3 - 1 + 0, 'hidden media removed from the published list');
    assert.ok(!JSON.stringify(data.media).includes('hidden'));
    assert.ok(body.startsWith('Visible text.'));
    assert.deepEqual(result.counts, { projects: 1, experience: 1, awards: 1, courses: 1, skills: 1, media: 2, resumes: 1 });
    assert.ok(!readText(site('src/content/experience/job.md')).includes('todo'));
    assert.ok(!readText(site('src/content/skills.json')).includes('todo'));
});

test('private items, notes, inbox and unreferenced media never leave the vault', async () => {
    const { vault, site, siteRoot } = await fixture();
    await vault.publish();
    assert.ok(!exists(site('src/content/projects/priv.md')));
    assert.ok(!exists(site('src/assets/media/projects/priv/secret.webp')));
    assert.ok(!exists(site('src/assets/media/projects/unlinked/orphan.webp')));
    assert.ok(!exists(site('src/assets/media/projects/pub/hidden.webp')), 'hidden media is not published');
    assert.ok(exists(site('src/assets/media/projects/pub/cover.webp')));
    assert.ok(exists(site('src/assets/media/projects/pub/shot.webp')));
    assert.ok(!readText(site('src/content/courses.json')).includes('Private course'));
    assert.deepEqual(findLeaks({ root: siteRoot }), []);
    // No note/inbox text anywhere in what was written
    const all = [];
    (function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : all.push(p); } })(siteRoot);
    for (const f of all.filter(f => /\.(md|json)$/.test(f))) assert.ok(!/secret (note|idea) body|Private (project|note)/.test(readText(f)), f);
});

test('items with errors are skipped and explained', async () => {
    const { vault, site } = await fixture();
    const preview = vault.previewPublish();
    const skipped = Object.fromEntries(preview.skipped.map(s => [s.id, s.errors.map(e => e.msg).join(' ')]));
    assert.match(skipped['bad-media'], /not found/);
    assert.match(skipped['no-hook'], /hook/i);
    assert.ok(!('pub' in skipped));
    await vault.publish();
    assert.ok(!exists(site('src/content/projects/bad-media.md')));
    assert.ok(!exists(site('src/content/projects/no-hook.md')));
});

test('preview reports added, updated and removed without writing', async () => {
    const { vault, site } = await fixture();
    const first = vault.previewPublish();
    assert.ok(first.changes.some(c => c.type === 'projects' && c.id === 'pub' && c.change === 'added'));
    assert.ok(!exists(site('src/content')), 'preview wrote files');
    await vault.publish();
    assert.deepEqual(vault.previewPublish().changes, []);

    const item = vault.getItem('projects', 'pub');
    vault.saveItem('projects', 'pub', { ...item.data, hook: 'A new hook.' }, item.body);
    write(path.join(site('src/content/projects/stale.md')), '---\ntitle: Stale\nhook: x\nvisibility: public\n---\n');
    const changes = vault.previewPublish().changes;
    assert.ok(changes.some(c => c.id === 'pub' && c.change === 'updated'));
    assert.ok(changes.some(c => c.id === 'stale' && c.change === 'removed'));
});

test('publish removes stale outputs, legacy folders and unlisted resumes', async () => {
    const { vault, site } = await fixture();
    write(site('src/content/projects/stale.md'), 'old');
    write(site('src/assets/media/old/gone.webp'), 'old');
    write(site('public/media/old/gone.mp4'), 'old');
    write(site('public/projects/images/x.webp'), 'old');
    write(site('public/vault-media/x.webp'), 'old');
    write(site('public/resume/rafaela-solis-resume.pdf'), 'old');
    write(site('src/data/resume-layers/ghost.json'), '{}');
    const { removed } = await vault.publish();
    for (const gone of ['src/content/projects/stale.md', 'src/assets/media/old/gone.webp', 'public/media/old/gone.mp4', 'public/projects', 'public/vault-media', 'public/resume/rafaela-solis-resume.pdf', 'src/data/resume-layers/ghost.json']) {
        assert.ok(!exists(site(gone)), `${gone} should be removed`);
    }
    assert.ok(removed.length >= 7);
    assert.ok(!exists(site('src/assets/media/old')), 'empty folders are pruned');
});

test('publish prerenders live resumes only', async () => {
    const { vault, site } = await fixture();
    const { resumes } = await vault.publish();
    assert.equal(resumes.length, 1);
    assert.ok(exists(site('public/resume/design.pdf')));
    assert.ok(!exists(site('public/resume/draft.pdf')), 'draft resumes do not deploy');
    assert.ok(exists(site('public/resume/design-p1.webp')));
    assert.ok(fs.statSync(site('public/resume/design-p1.webp')).size > 10_000);

    const list = JSON.parse(readText(site('src/data/resumes.json')));
    assert.equal(list.length, 1);
    assert.deepEqual(list[0], {
        id: 'design', label: 'Design', lens: 'design', file: '/resume/design.pdf',
        pages: [{ src: '/resume/design-p1.webp', width: 1275, height: 1650 }],
    });
    const layer = JSON.parse(readText(site('src/data/resume-layers/design.json')));
    assert.equal(layer.pages.length, 1);
    assert.ok(layer.pages[0].text.length > 20);
    for (const t of layer.pages[0].text) assert.ok(t.x >= 0 && t.x <= 100 && t.y >= 0 && t.y <= 100);

    // Second publish reuses the render
    const again = await vault.publish();
    assert.equal(again.resumes[0].cached, true);
});

test('publish refuses when no resume is live', async () => {
    const { vault, vaultDir } = await fixture();
    write(path.join(vaultDir, 'resumes.json'), '[]');
    await assert.rejects(vault.publish(), /No live resume/);
});

test('video publishing: poster and facts', { skip: !hasFfmpeg() && 'ffmpeg not installed' }, async () => {
    const { vault, site, vaultDir } = await fixture({ video: true });
    await vault.publish();
    assert.ok(exists(site('public/media/projects/pub/clip.mp4')));
    assert.ok(exists(site('public/media/projects/pub/clip.poster.webp')));
    assert.ok(!exists(site('src/assets/media/projects/pub/clip.mp4')), 'videos do not go through the image pipeline');
    const meta = JSON.parse(readText(site('src/data/media-meta.json')));
    const m = meta['/vault-media/projects/pub/clip.mp4'];
    assert.equal(m.width, 320);
    assert.ok(m.duration > 1 && m.duration < 2 && m.bytes > 0);
});

test('saving keeps the body byte for byte and refuses stale writes', async () => {
    const { vault } = await fixture();
    const body = '\n  leading blank and spaces\n\nA line with trailing space \n\n\n- list\n<!-- keep in vault -->\n';
    const first = vault.saveItem('projects', 'roundtrip', { title: 'R', hook: 'h' }, body);
    assert.equal(first.body, body);
    const again = vault.saveItem('projects', 'roundtrip', { ...first.data, hook: 'changed' }, first.body, { baseMtime: first.mtime });
    assert.equal(again.body, body);
    assert.equal(again.data.hook, 'changed');

    await new Promise(r => setTimeout(r, 15));
    vault.saveItem('projects', 'roundtrip', again.data, again.body);
    assert.throws(() => vault.saveItem('projects', 'roundtrip', again.data, again.body, { baseMtime: first.mtime }), StaleError);
});

test('create, rename, delete, restore, reorder', async () => {
    const { vault } = await fixture();
    const a = vault.createItem('projects', { title: 'Brand New' });
    assert.equal(a.id, 'brand-new');
    assert.equal(a.data.visibility, 'private');
    assert.equal(vault.createItem('projects', { title: 'Brand New' }).id, 'brand-new-2');
    assert.throws(() => vault.createItem('projects', { title: '   ' }), /name/);

    const renamed = vault.renameItem('projects', 'brand-new', 'fresh');
    assert.equal(renamed.id, 'fresh');
    assert.ok(!vault.listItems('projects').items.some(i => i.id === 'brand-new'));

    const trashId = vault.deleteItem('projects', 'fresh');
    assert.ok(vault.listTrash().some(t => t.trashId === trashId && t.title === 'Brand New'));
    assert.ok(!vault.listItems('projects').items.some(i => i.id === 'fresh'));
    assert.equal(vault.restoreItem(trashId).id, 'fresh');

    vault.reorder('projects', ['fresh', 'pub']);
    const order = Object.fromEntries(vault.listItems('projects').items.map(i => [i.id, i.data.order]));
    assert.equal(order.fresh, 1);
    assert.equal(order.pub, 2);

    // JSON collections behave the same way
    const course = vault.createItem('courses', { title: 'New Course' });
    const t2 = vault.deleteItem('courses', course.id);
    assert.ok(!vault.listItems('courses').items.some(i => i.id === course.id));
    assert.equal(vault.restoreItem(t2).data.name, 'New Course');
});

test('ids cannot escape the vault', async () => {
    const { vault } = await fixture();
    assert.throws(() => vault.saveItem('projects', '../evil', { title: 'x' }), /Invalid id/);
    assert.throws(() => vault.getItem('nope', 'x'), /Unknown collection/);
});

test('filing an inbox capture creates the item and trashes the capture', async () => {
    const { vault } = await fixture();
    const filed = vault.fileInbox('idea', 'projects');
    assert.equal(filed.data.title, 'Idea');
    assert.equal(filed.body, 'secret idea body');
    assert.equal(filed.data.visibility, 'private');
    assert.ok(!vault.listItems('inbox').items.length);
    assert.throws(() => vault.fileInbox('x', 'courses'), /Can't file/);
});

test('media usage lists what each file belongs to', async () => {
    const { vault } = await fixture();
    const usage = Object.fromEntries(vault.mediaUsage().map(u => [u.rel, u.usedBy]));
    assert.deepEqual(usage['projects/pub/cover.webp'], [{ type: 'projects', id: 'pub' }]);
    assert.deepEqual(usage['projects/unlinked/orphan.webp'], []);
    assert.ok(usage['projects/pub/hidden.webp'].length === 1, 'hidden media still counts as used');
});

test('leak check catches vault-only content in the published folders', async () => {
    const { siteRoot } = await fixture();
    write(path.join(siteRoot, 'src/content/projects/leaky.md'), '---\ntitle: x\ntodo:\n  - hi\nvisibility: private\n---\nTODO(fix)');
    write(path.join(siteRoot, 'src/data/x.json'), '{"todo": []}');
    write(path.join(siteRoot, 'dist/index.html'), '<p>Lorem ipsum</p><img src="https://picsum.photos/1">');
    write(path.join(siteRoot, 'dist/article/index.html'), '<p>Lorem ipsum (the Studio Journal demo)</p>');
    const src = findLeaks({ root: siteRoot });
    assert.ok(src.some(p => p.includes('leaky.md') && /todo/.test(p)));
    assert.ok(src.some(p => /private item/.test(p)));
    assert.ok(src.some(p => /TODO\(/.test(p)));
    assert.ok(src.some(p => p.includes('x.json')));
    const dist = findLeaks({ root: siteRoot, dist: true });
    assert.ok(dist.some(p => /lorem/.test(p)) && dist.some(p => /picsum/.test(p)));
    assert.ok(!dist.some(p => p.includes('dist/article')), 'the /article demo may use placeholders');
});

test('JSON collection entries are versioned independently', async () => {
    const { vault } = await fixture();
    const a = vault.createItem('courses', { title: 'Course A' });
    const b = vault.createItem('courses', { title: 'Course B' });
    vault.saveItem('courses', a.id, { ...a.data, order: 5 }, '', { baseMtime: a.mtime });
    // B was loaded before A changed; it is still current
    const saved = vault.saveItem('courses', b.id, { ...b.data, order: 6 }, '', { baseMtime: b.mtime });
    assert.equal(saved.data.order, 6);
    assert.throws(() => vault.saveItem('courses', b.id, b.data, '', { baseMtime: b.mtime }), StaleError);
});

// ── Regressions from the v2 end-to-end review ─────────────────────────────

test('hand-typed numbers (year: 2025) are text, not a silent unpublish', async () => {
    const { vault, vaultDir, site } = await fixture();
    await vault.publish({ prerender: false });
    const file = path.join(vaultDir, 'projects/pub.md');
    // Written as bare YAML numbers, the way she would type them
    fs.writeFileSync(file, readText(file).replace(/^year: .*$/m, 'year: 2025').replace(/^(featured: true)$/m, '$1\nduration: 3\nteam: 4'));
    assert.equal(typeof parseMd(readText(file)).data.year, 'number', 'precondition: YAML read a number');
    const it = vault.getItem('projects', 'pub');
    assert.strictEqual(it.data.year, '2025');
    assert.strictEqual(it.data.duration, '3');
    assert.strictEqual(it.data.team, '4');
    assert.ok(!vault.listItems('projects').items.find(i => i.id === 'pub').readiness.warnings.some(w => w.field === 'year'), 'year is not "unset"');
    const preview = vault.previewPublish();
    assert.ok(!preview.skipped.some(s => s.id === 'pub'));
    assert.ok(!preview.changes.some(c => c.id === 'pub' && c.change === 'removed'));
    await vault.publish({ prerender: false });
    assert.ok(exists(site('src/content/projects/pub.md')));
});

test('schema errors show in the item readiness, the same ones publish enforces', async () => {
    const { vault, vaultDir } = await fixture();
    write(path.join(vaultDir, 'projects/odd.md'), stringifyMd({ title: 'Odd', hook: 'h', visibility: 'public', kind: 'not-a-kind' }, ''));
    const odd = vault.listItems('projects').items.find(i => i.id === 'odd');
    assert.ok(odd.readiness.errors.some(e => e.field === 'kind'), JSON.stringify(odd.readiness));
    assert.ok(vault.previewPublish().skipped.some(s => s.id === 'odd'));
});

test('a previously published item that now has errors is flagged, with its title', async () => {
    const { vault, vaultDir } = await fixture();
    await vault.publish({ prerender: false });
    const file = path.join(vaultDir, 'projects/pub.md');
    const { data, body } = parseMd(readText(file));
    fs.writeFileSync(file, stringifyMd({ ...data, hook: '' }, body));
    const removed = vault.previewPublish().changes.find(c => c.id === 'pub');
    assert.equal(removed.change, 'removed');
    assert.equal(removed.reason, 'errors');
    assert.equal(removed.title, 'Public project');
});

test('a file that does not parse blocks publish instead of deleting its published copy', async () => {
    const { vault, vaultDir, site } = await fixture();
    await vault.publish({ prerender: false });
    const file = path.join(vaultDir, 'projects/pub.md');
    fs.writeFileSync(file, readText(file).replace('title: Public project', 'title: [unclosed'));
    const preview = vault.previewPublish();
    assert.ok(preview.broken.some(b => b.file === 'projects/pub.md'));
    assert.equal(preview.changes.find(c => c.id === 'pub').reason, 'broken');
    await assert.rejects(() => vault.publish({ prerender: false }), /projects\/pub\.md/);
    assert.ok(exists(site('src/content/projects/pub.md')), 'published copy untouched');
});

test('a UTF-8 BOM (Windows PowerShell) does not break md or json files', async () => {
    const { vault, vaultDir } = await fixture();
    const BOM = '﻿';
    const md = path.join(vaultDir, 'projects/pub.md');
    fs.writeFileSync(md, BOM + readText(md));
    const it = vault.getItem('projects', 'pub');
    assert.equal(it.data.title, 'Public project');
    assert.ok(it.body.startsWith('Visible text.'));
    vault.saveItem('projects', 'pub', it.data, it.body);
    assert.ok(!readText(md).includes(BOM), 'saved without a BOM');
    assert.equal(parseMd(BOM + '---\ntitle: T\n---\nbody').data.title, 'T');
    const cj = path.join(vaultDir, 'courses.json');
    fs.writeFileSync(cj, BOM + readText(cj));
    assert.equal(vault.listItems('courses').items.length, 2);
    assert.equal(vault.listItems('courses').broken.length, 0);
});

test('round trip keeps plain files plain and reorder is all-or-nothing', async () => {
    const { vault, vaultDir } = await fixture();
    assert.equal(stringifyMd({}, 'just text\n'), 'just text\n');
    const read = () => ['pub', 'priv'].map(id => readText(path.join(vaultDir, `projects/${id}.md`)));
    const before = read();
    assert.throws(() => vault.reorder('projects', ['priv', 'pub', 'missing']), /missing/);
    assert.deepEqual(read(), before);
});

test('gitStatus reports branch, changes and ahead from one git call per repo', async () => {
    const { vault, vaultDir } = await fixture();
    const { spawnSync } = await import('node:child_process');
    spawnSync('git', ['init', '-q', '-b', 'dev'], { cwd: vaultDir, windowsHide: true });
    fs.writeFileSync(path.join(vaultDir, 'x.txt'), 'x');
    const s = await vault.gitStatus();
    assert.equal(s.vault.branch, 'dev');
    assert.ok(s.vault.changed > 0);
    assert.equal(s.vault.ahead, 0);
    assert.equal(s.site, null);
});

test('the vault .gitignore keeps transcode scratch files and originals out of history', async () => {
    const { vaultDir } = await fixture();
    fs.writeFileSync(path.join(vaultDir, '.gitignore'), 'chrome-profile/');
    assert.deepEqual(ensureVaultIgnore(vaultDir), ['media/_originals/', '*.part.mp4', '*.tmp']);
    assert.deepEqual(ensureVaultIgnore(vaultDir), []);
    assert.match(readText(path.join(vaultDir, '.gitignore')), /^chrome-profile\/\n/);
});

test('media usage ignores transcode scratch files', async () => {
    const { vault, vaultDir } = await fixture();
    write(path.join(vaultDir, 'media/projects/pub/clip.mp4.part.mp4'), 'partial');
    assert.ok(!vault.mediaUsage().some(m => m.rel.endsWith('.part.mp4')));
});

test('preview reports site text, resume list and resume PDF changes', async () => {
    const { vault, vaultDir, site } = await fixture();
    let c = vault.previewPublish().changes;
    assert.ok(c.some(x => x.type === 'site' && x.change === 'added'));
    assert.ok(c.some(x => x.type === 'resumes' && x.id === 'pdf:design.pdf' && x.change === 'added'));
    await vault.publish();
    assert.deepEqual(vault.previewPublish().changes, []);

    vault.writeSite({ home: { tagline: 'Changed' }, about: { intro: 'New' } });
    c = vault.previewPublish().changes;
    const s = c.find(x => x.type === 'site');
    assert.equal(s.change, 'updated');
    assert.match(s.summary, /home/);

    await vault.publish();
    fs.appendFileSync(path.join(vaultDir, 'resumes/design.pdf'), '\n% edited\n');
    c = vault.previewPublish().changes;
    assert.deepEqual(c.map(x => [x.type, x.id, x.change]), [['resumes', 'pdf:design.pdf', 'updated']]);

    await vault.publish();
    write(site('public/resume/old.pdf'), 'x');
    c = vault.previewPublish().changes;
    assert.ok(c.some(x => x.id === 'pdf:old.pdf' && x.change === 'removed'));

    await vault.publish();
    vault.writeResumes([{ id: 'design', label: 'Design Lead', lens: 'design', file: 'resumes/design.pdf', status: 'live' }]);
    c = vault.previewPublish().changes;
    assert.ok(c.some(x => x.type === 'resumes' && x.id === 'resumes' && x.change === 'updated'));
});
