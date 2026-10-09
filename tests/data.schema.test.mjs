import test from 'node:test';
import assert from 'node:assert/strict';
import { schemas, publicSchema, publicKeys, resumesSchema } from '../src/lib/schema.mjs';
import {
    normalizeMedia, visibleMedia, mediaRel, vaultMediaSrc, isVideo, posterSrcFor, publishedPath, mediaRefs, imageGlobKey, publicMediaUrl,
} from '../src/lib/media.mjs';
import { readiness, isValidUrl, HOOK_MAX } from '../src/lib/readiness.mjs';

const project = (extra = {}) => ({
    title: 'Game', hook: 'A short hook.', visibility: 'public', featured: false,
    image: '/vault-media/projects/g/cover.webp',
    media: [{ src: '/vault-media/projects/g/cover.webp', alt: 'Cover' }],
    links: [{ label: 'Play', url: 'https://example.itch.io/game' }],
    contribution: ['a', 'b', 'c'], year: '2025', ...extra,
});

const ctxWith = files => ({
    mediaExists: rel => rel in files,
    mediaBytes: rel => files[rel] ?? null,
    projectIds: new Set(['g']),
});
const FILES = { 'projects/g/cover.webp': 1000 };

test('project schema accepts string and object media, applies defaults', () => {
    const r = schemas.projects.parse({ title: 'T', hook: 'H', media: ['/vault-media/a.webp', { src: '/vault-media/b.webp', alt: 'B', hidden: true }] });
    assert.equal(r.visibility, 'private');
    assert.equal(r.featured, false);
    assert.deepEqual(r.todo, []);
    assert.equal(r.media.length, 2);
});

test('project schema takes the new optional fields', () => {
    const r = schemas.projects.parse({
        title: 'T', hook: 'H', year: '2024-2025', kind: 'team', platforms: ['PC'], credits: [{ name: 'A', role: 'Design' }],
        problem: 'p', goal: 'g', result: 'r', reflection: 'x', iterations: [{ before: 'b', finding: 'f', change: 'c' }],
    });
    assert.equal(r.kind, 'team');
    assert.equal(r.iterations[0].change, 'c');
    assert.throws(() => schemas.projects.parse({ title: 'T', hook: 'H', kind: 'nonsense' }));
});

test('public schema and allowlist leave out vault-only keys', () => {
    assert.ok(!publicKeys('projects').includes('todo'));
    assert.ok(publicKeys('projects').includes('hook'));
    assert.ok(!('todo' in publicSchema('projects').shape));
    assert.ok(!publicKeys('awards').includes('todo'));
});

test('resumes schema defaults to draft', () => {
    const [r] = resumesSchema.parse([{ id: 'a', label: 'A', file: 'resumes/a.pdf' }]);
    assert.equal(r.status, 'draft');
});

test('normalizeMedia: strings and objects become uniform objects', () => {
    const out = normalizeMedia(['/vault-media/a.webp', { src: '/vault-media/v.mp4', alt: ' clip ', caption: 'c', poster: '/vault-media/p.webp', hidden: true }, '', null, { alt: 'no src' }]);
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], { src: '/vault-media/a.webp', alt: '', caption: '', poster: null, hidden: false, video: false });
    assert.deepEqual(out[1], { src: '/vault-media/v.mp4', alt: 'clip', caption: 'c', poster: '/vault-media/p.webp', hidden: true, video: true });
});

test('normalizeMedia: cover is prepended once; visibleMedia drops hidden', () => {
    const media = ['/vault-media/a.webp', { src: '/vault-media/b.webp', hidden: true }];
    assert.equal(normalizeMedia(media, { cover: '/vault-media/c.webp' })[0].src, '/vault-media/c.webp');
    assert.equal(normalizeMedia(media, { cover: '/vault-media/a.webp' }).length, 2);
    assert.deepEqual(visibleMedia(media).map(m => m.src), ['/vault-media/a.webp']);
    assert.deepEqual(normalizeMedia(undefined), []);
});

test('media path helpers', () => {
    assert.equal(mediaRel('/vault-media/projects/x/a%20b.webp'), 'projects/x/a b.webp');
    assert.equal(mediaRel('/vault-media/../secret'), null);
    assert.equal(mediaRel('/vault-media/a//b'), null);
    assert.equal(mediaRel('https://x.com/a.webp'), null);
    assert.equal(vaultMediaSrc('projects/x/a b.webp'), '/vault-media/projects/x/a%20b.webp');
    assert.ok(isVideo('/x/a.MP4') && !isVideo('/x/a.webp'));
    assert.equal(posterSrcFor({ src: '/vault-media/p/v.mp4', poster: null }), '/vault-media/p/v.poster.webp');
    assert.equal(posterSrcFor({ src: '/vault-media/p/v.mp4', poster: '/vault-media/p/own.webp' }), '/vault-media/p/own.webp');
    assert.equal(publishedPath('projects/x/a.webp'), 'src/assets/media/projects/x/a.webp');
    assert.equal(publishedPath('projects/x/v.mp4'), 'public/media/projects/x/v.mp4');
    assert.equal(publishedPath('projects/x/v.poster.webp'), 'public/media/projects/x/v.poster.webp');
    assert.equal(imageGlobKey('/vault-media/projects/x/a.webp'), '/src/assets/media/projects/x/a.webp');
    assert.equal(publicMediaUrl('/vault-media/projects/x/v.mp4'), '/media/projects/x/v.mp4');
});

test('mediaRefs lists cover, gallery and video posters, skipping hidden', () => {
    const refs = mediaRefs({
        image: '/vault-media/p/c.webp',
        media: ['/vault-media/p/c.webp', '/vault-media/p/v.mp4', { src: '/vault-media/p/h.webp', hidden: true }],
    });
    assert.deepEqual(refs.sort(), ['p/c.webp', 'p/v.mp4', 'p/v.poster.webp']);
    assert.ok(mediaRefs({ media: [{ src: '/vault-media/p/h.webp', hidden: true }] }, { includeHidden: true }).includes('p/h.webp'));
});

test('readiness: a complete project has no errors', () => {
    const r = readiness('projects', project(), ctxWith(FILES));
    assert.deepEqual(r.errors, []);
});

test('readiness errors: title, hook, missing media, invalid url', () => {
    const r = readiness('projects', project({
        title: ' ', hook: '', media: ['/vault-media/projects/g/missing.webp'], links: [{ label: 'x', url: 'not a url' }],
    }), ctxWith(FILES));
    const fields = r.errors.map(e => e.field);
    assert.ok(fields.includes('title') && fields.includes('hook'));
    assert.ok(r.errors.some(e => /not found/.test(e.msg)));
    assert.ok(fields.includes('links.0'));
});

test('readiness errors: non-vault and unsupported media', () => {
    const r = readiness('projects', project({ image: undefined, media: ['https://example.com/a.webp', '/vault-media/projects/g/a.gif'] }), ctxWith({ 'projects/g/a.gif': 5 }));
    assert.ok(r.errors.some(e => /not in the vault/.test(e.msg)));
    assert.ok(r.errors.some(e => /supported image/.test(e.msg)));
});

test('readiness warnings', () => {
    const r = readiness('projects', project({
        featured: true, image: undefined, media: [], year: undefined, links: [], contribution: ['one'],
        hook: 'x'.repeat(HOOK_MAX + 1), body: 'Still a TODO here',
    }), ctxWith(FILES));
    const fields = r.warnings.map(w => w.field);
    for (const f of ['image', 'contribution', 'year', 'links', 'hook', 'body']) assert.ok(fields.includes(f), `missing warning for ${f}`);
    assert.equal(r.errors.length, 0);
});

test('readiness warnings: alt text, big video, dead internal link', () => {
    const r = readiness('projects', project({
        media: [{ src: '/vault-media/projects/g/cover.webp' }, { src: '/vault-media/projects/g/big.mp4', alt: 'x' }],
        links: [{ label: 'Article', url: '/article/' }, { label: 'Other', url: '/projects/g/' }],
    }), ctxWith({ ...FILES, 'projects/g/big.mp4': 13 * 1024 * 1024 }));
    assert.ok(r.warnings.some(w => /no alt text/.test(w.msg)));
    assert.ok(r.warnings.some(w => /MB/.test(w.msg)));
    assert.ok(r.warnings.some(w => w.field === 'links.0'));
    assert.ok(!r.warnings.some(w => w.field === 'links.1'));
});

test('readiness: experience and awards', () => {
    assert.deepEqual(readiness('experience', { title: 'T', org: '', start: '', bullets: [] }).errors.map(e => e.field), ['org', 'start']);
    const a = readiness('awards', { title: 'A', url: 'nope' });
    assert.deepEqual(a.errors.map(e => e.field), ['url']);
    assert.ok(readiness('awards', { title: 'A', project: 'ghost' }, ctxWith({})).warnings.some(w => w.field === 'project'));
});

test('readiness: site warns about the missing proof line', () => {
    const live = [{ id: 'a', label: 'A', status: 'live', file: 'resumes/a.pdf' }];
    const r = readiness('site', { site: { home: { tagline: 't' }, about: { bio: ['b'] } }, resumes: live }, { resumeExists: () => true });
    assert.deepEqual(r.warnings.map(w => w.field), ['home.proof']);
    const bad = readiness('site', { site: {}, resumes: live }, { resumeExists: () => false });
    assert.equal(bad.errors.length, 1);
});

test('isValidUrl', () => {
    for (const ok of ['https://a.itch.io/x', 'http://localhost:3000', 'mailto:a@b.co', '/projects/x/']) assert.ok(isValidUrl(ok), ok);
    for (const bad of ['', 'a.itch.io', 'javascript:alert(1)', '//evil.com', 'https://nodot', null]) assert.ok(!isValidUrl(bad), String(bad));
});

test('logo: published with the media, and checked like an image', () => {
    assert.ok(schemas.projects.parse(project({ logo: '/vault-media/projects/g/logo.webp' })).logo);
    assert.ok(publicKeys('projects').includes('logo'));
    assert.ok(mediaRefs({ logo: '/vault-media/p/logo.webp' }).includes('p/logo.webp'));

    const ok = readiness('projects', project({ logo: '/vault-media/projects/g/logo.webp' }), ctxWith({ ...FILES, 'projects/g/logo.webp': 9 }));
    assert.deepEqual(ok.errors, []);
    const missing = readiness('projects', project({ logo: '/vault-media/projects/g/nope.webp' }), ctxWith(FILES));
    assert.ok(missing.errors.some(e => e.field === 'logo' && /not found/.test(e.msg)));
    const video = readiness('projects', project({ logo: '/vault-media/projects/g/clip.mp4' }), ctxWith({ ...FILES, 'projects/g/clip.mp4': 9 }));
    assert.ok(video.errors.some(e => e.field === 'logo' && /must be an image/.test(e.msg)));
});
