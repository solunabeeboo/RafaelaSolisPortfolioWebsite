import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { ingest, processImage, probeVideo, findGhostscript } from '../scripts/media.mjs';
import { tmpDir, write, writeVideo, hasFfmpeg } from './data-helpers.mjs';

test('processImage caps the longest side and writes WebP', async () => {
    const dir = tmpDir('media');
    const big = path.join(dir, 'big.png');
    await sharp({ create: { width: 3000, height: 1000, channels: 3, background: '#aa3300' } }).png().toFile(big);
    const out = path.join(dir, 'out.webp');
    const progress = [];
    const r = await processImage(big, out, { onProgress: p => progress.push(p) });
    assert.equal(r.width, 2400);
    assert.equal(r.height, 800);
    assert.equal((await sharp(out).metadata()).format, 'webp');
    assert.ok(progress.length >= 2 && progress.at(-1) === 100);
});

test('processImage never enlarges', async () => {
    const dir = tmpDir('media');
    const src = path.join(dir, 'small.jpg');
    await sharp({ create: { width: 200, height: 100, channels: 3, background: '#000' } }).jpeg().toFile(src);
    const r = await processImage(src, path.join(dir, 'small.webp'));
    assert.equal(r.width, 200);
});

test('ingest: raster becomes WebP in the destination', async () => {
    const dir = tmpDir('media');
    const src = path.join(dir, 'My Shot.jpg');
    await sharp({ create: { width: 100, height: 80, channels: 3, background: '#123456' } }).jpeg().toFile(src);
    const r = await ingest(src, { destDir: path.join(dir, 'dest'), stem: 'my-shot' });
    assert.equal(r.kind, 'image');
    assert.equal(r.file, 'my-shot.webp');
    assert.ok(fs.existsSync(path.join(dir, 'dest/my-shot.webp')));
});

test('ingest rejects unsupported files', async () => {
    const dir = tmpDir('media');
    write(path.join(dir, 'doc.pdf'), 'x');
    await assert.rejects(ingest(path.join(dir, 'doc.pdf'), { destDir: dir }), /Unsupported/);
});

test('ingest: video is transcoded with a poster and the original kept', { skip: !hasFfmpeg() && 'ffmpeg not installed' }, async () => {
    const dir = tmpDir('media');
    const raw = path.join(dir, 'Raw Clip.mp4');
    writeVideo(raw);
    const pcts = [];
    const r = await ingest(raw, { destDir: path.join(dir, 'dest'), stem: 'clip', originalsDir: path.join(dir, 'orig'), onProgress: p => pcts.push(p) });
    assert.equal(r.kind, 'video');
    assert.deepEqual([r.file, r.poster], ['clip.mp4', 'clip.poster.webp']);
    assert.equal(r.width, 320);
    assert.ok(r.duration > 1 && r.duration < 2);
    assert.ok(fs.existsSync(path.join(dir, 'orig/clip.mp4')));
    assert.ok(pcts.includes(100) && pcts.every((p, i) => i === 0 || p >= pcts[i - 1]), 'progress is monotonic');
    assert.equal((await sharp(path.join(dir, 'dest/clip.poster.webp')).metadata()).format, 'webp');
    const info = await probeVideo(path.join(dir, 'dest/clip.mp4'));
    assert.equal(info.hasAudio, false);
});

test('ingest: a GIF becomes an MP4', { skip: !hasFfmpeg() && 'ffmpeg not installed' }, async () => {
    const dir = tmpDir('media');
    const gif = path.join(dir, 'anim.gif');
    const { spawnSync } = await import('node:child_process');
    const { findFfmpeg } = await import('../scripts/media.mjs');
    const made = spawnSync(findFfmpeg(), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=1', gif], { windowsHide: true });
    assert.equal(made.status, 0);
    const r = await ingest(gif, { destDir: path.join(dir, 'dest'), stem: 'anim' });
    assert.equal(r.file, 'anim.mp4');
    assert.ok(fs.existsSync(path.join(dir, 'dest/anim.poster.webp')));
});

test('tool discovery finds Ghostscript when installed', { skip: !findGhostscript() && 'Ghostscript not installed' }, () => {
    assert.match(findGhostscript(), /gs(win(32|64)c)?(\.exe)?$/i);
});
