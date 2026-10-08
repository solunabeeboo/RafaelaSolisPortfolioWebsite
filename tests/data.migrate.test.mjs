import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { migrate, safeFileName, formatReport } from '../scripts/migrate-media.mjs';
import { parseMd, stringifyMd } from '../scripts/vault-lib.mjs';
import { tmpDir, write, writeImage, writeVideo, hasFfmpeg, snapshot, SAMPLE_PDF } from './data-helpers.mjs';

const BODY = 'Case study text.\n\n## Process\n\nKept exactly.\n';

/** An old-layout site repo (images under public/projects) and a vault whose projects point at them. */
async function fixture({ video = true } = {}) {
    const root = tmpDir('migrate');
    const siteRoot = path.join(root, 'site'), vaultDir = path.join(root, 'vault');
    const pub = p => path.join(siteRoot, 'public', p);
    await writeImage(pub('projects/images/cover pic.webp'));
    await writeImage(pub('projects/screenshots/shot (1).webp'));
    await writeImage(pub('projects/screenshots/shot (2).webp'));
    await writeImage(pub('projects/screenshots/Other Shot.webp'));
    await writeImage(pub('projects/images/never-used.webp'));
    if (video) writeVideo(pub('projects/screenshots/demo (1).mp4'));
    fs.mkdirSync(pub('resume'), { recursive: true });
    for (const n of ['design', '']) fs.copyFileSync(SAMPLE_PDF, pub(`resume/rafaela-solis-resume${n ? '-' + n : ''}.pdf`));
    write(path.join(siteRoot, 'src/data/site.json'), JSON.stringify({ home: { tagline: 'Hi' } }));
    write(path.join(siteRoot, 'src/data/resumes.json'), JSON.stringify({
        resumes: [
            { id: 'design', label: 'Design', discipline: 'design', file: '/resume/rafaela-solis-resume-design.pdf', enabled: true },
            { id: 'current', label: 'Old resume', file: '/resume/rafaela-solis-resume.pdf', enabled: false },
        ],
    }));

    const flow = `---
title: "Game One"
hook: "A hook."
visibility: "public"
image: "/projects/images/cover pic.webp"
media: [
  "/projects/images/cover pic.webp",
  "/projects/screenshots/shot (1).webp",
  "/projects/screenshots/shot (2).webp",
  "/projects/screenshots/Other Shot.webp"${video ? ',\n  "/projects/screenshots/demo (1).mp4"' : ''}
  ]
tags: ["A","B"]
todo: ["keep me"]
---

${BODY}`;
    write(path.join(vaultDir, 'projects/game-one.md'), flow);
    write(path.join(vaultDir, 'projects/empty.md'), '---\ntitle: "Empty"\nhook: "h"\nmedia: []\n---\n\nBody.\n');
    write(path.join(vaultDir, 'experience/job.md'), '---\ntitle: "Job"\norg: "Org"\nstart: "2024"\nbullets: ["a","b"]\n---\n');
    return { root, siteRoot, vaultDir };
}

const run = (f, extra = {}) => migrate({ vaultDir: f.vaultDir, siteRoot: f.siteRoot, ...extra });

test('safeFileName makes slug-safe names', () => {
    assert.equal(safeFileName('bender (1).webp'), 'bender-1.webp');
    assert.equal(safeFileName('Screenshot 2026-03-14 154618.WEBP'), 'screenshot-2026-03-14-154618.webp');
    assert.equal(safeFileName('BeachScene(1).mp4'), 'beachscene-1.mp4');
    assert.equal(safeFileName('clip.MOV'), 'clip.mp4');
});

test('dry run reports the plan and writes nothing', async () => {
    const f = await fixture({ video: hasFfmpeg() });
    const before = snapshot(f.root);
    const report = await run(f, { dryRun: true });
    assert.deepEqual(snapshot(f.root), before, 'dry run changed files');
    assert.equal(report.dryRun, true);
    assert.equal(report.media.length, hasFfmpeg() ? 5 : 4);
    assert.ok(report.media.some(m => m.from === '/projects/screenshots/shot (1).webp' && m.to === '/vault-media/projects/game-one/shot-1.webp'));
    assert.ok(report.rewritten.includes('projects/game-one.md'));
    assert.match(formatReport(report), /dry run/);
});

test('migration moves media, rewrites refs, keeps bodies, moves site and resumes', async () => {
    const f = await fixture({ video: hasFfmpeg() });
    const report = await run(f);
    const v = (...p) => path.join(f.vaultDir, ...p);

    // Files landed under slug-safe names
    for (const n of ['cover-pic.webp', 'shot-1.webp', 'shot-2.webp', 'other-shot.webp']) assert.ok(fs.existsSync(v('media/projects/game-one', n)), n);

    const { data, body } = parseMd(fs.readFileSync(v('projects/game-one.md'), 'utf8'));
    assert.equal(data.image, '/vault-media/projects/game-one/cover-pic.webp');
    assert.equal(data.media[1], '/vault-media/projects/game-one/shot-1.webp');
    assert.ok(data.media.every(m => m.startsWith('/vault-media/projects/game-one/')));
    assert.deepEqual(data.todo, ['keep me']);
    assert.equal(body, BODY);

    // Block YAML, one pass
    const text = fs.readFileSync(v('projects/game-one.md'), 'utf8');
    assert.ok(!/^media: \[/m.test(text) && /^media:\n  - /m.test(text));
    assert.ok(!/^tags: \[/m.test(text));
    assert.ok(report.rewritten.includes('experience/job.md'));

    if (hasFfmpeg()) {
        assert.ok(fs.existsSync(v('media/projects/game-one/demo-1.mp4')));
        assert.ok(fs.existsSync(v('media/projects/game-one/demo-1.poster.webp')));
        assert.ok(fs.existsSync(v('media/_originals/projects/game-one/demo (1).mp4')), 'original kept');
        assert.equal(report.videos.length, 1);
    }

    // Unreferenced legacy file kept, not lost
    assert.ok(fs.existsSync(v('media/unused-from-site/projects/images/never-used.webp')));
    assert.deepEqual(report.unusedKept, ['public/projects/images/never-used.webp']);

    // site.json and resumes moved
    assert.deepEqual(JSON.parse(fs.readFileSync(v('site.json'), 'utf8')), { home: { tagline: 'Hi' } });
    assert.deepEqual(JSON.parse(fs.readFileSync(v('resumes.json'), 'utf8')), [
        { id: 'design', label: 'Design', lens: 'design', file: 'resumes/rafaela-solis-resume-design.pdf', status: 'live' },
        { id: 'current', label: 'Old resume', file: 'resumes/archive/rafaela-solis-resume.pdf', status: 'draft' },
    ]);
    assert.ok(fs.existsSync(v('resumes/rafaela-solis-resume-design.pdf')));
    assert.ok(fs.existsSync(v('resumes/archive/rafaela-solis-resume.pdf')));
    assert.match(fs.readFileSync(v('.gitignore'), 'utf8'), /^media\/_originals\/$/m);

    // The site repo is only read
    assert.ok(fs.existsSync(path.join(f.siteRoot, 'public/projects/images/cover pic.webp')));
});

test('migration is idempotent', async () => {
    const f = await fixture({ video: hasFfmpeg() });
    await run(f);
    const after = snapshot(f.vaultDir);
    const second = await run(f);
    assert.deepEqual(snapshot(f.vaultDir), after, 'second run changed files');
    assert.equal(second.media.length, 0);
    assert.equal(second.rewritten.length, 0);
    assert.equal(second.unusedKept.length, 0);
    assert.equal(second.resumes.length, 0);
});

test('a missing source is reported and its ref left alone', async () => {
    const f = await fixture({ video: false });
    fs.rmSync(path.join(f.siteRoot, 'public/projects/screenshots/shot (2).webp'));
    const report = await run(f);
    assert.deepEqual(report.missing, [{ project: 'game-one', ref: '/projects/screenshots/shot (2).webp' }]);
    const { data } = parseMd(fs.readFileSync(path.join(f.vaultDir, 'projects/game-one.md'), 'utf8'));
    assert.ok(data.media.includes('/projects/screenshots/shot (2).webp'));
});

test('stringifyMd writes the body exactly and parseMd reads it back', () => {
    for (const body of ['', 'x', '\nstarts blank\n', 'a\n\n\nb\n\n']) {
        assert.equal(parseMd(stringifyMd({ title: 't' }, body)).body, body);
    }
});
