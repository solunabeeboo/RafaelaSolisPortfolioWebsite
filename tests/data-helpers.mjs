/** Shared fixtures for the data-layer tests. Not a test file itself. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';
import { findFfmpeg } from '../scripts/media.mjs';

export const REPO = path.resolve(import.meta.dirname, '..');
/** A real one-page resume PDF that ships with the site. */
export const SAMPLE_PDF = path.join(REPO, 'public/resume/rafaela-solis-resume-design.pdf');

const made = [];
// sharp's file cache holds handles on Windows, which blocks deleting the fixtures
sharp.cache(false);
process.on('exit', () => {
    for (const d of made) {
        try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch { /* temp folder; the OS will clear it */ }
    }
});

/** A fresh temp folder, removed when the test process exits. */
export function tmpDir(name) {
    const dir = fs.mkdtempSync(path.join(process.env.TEST_TMP || os.tmpdir(), `${name}-`));
    made.push(dir);
    return dir;
}

export const write = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
};

export async function writeImage(file, color = '#336699', ext = path.extname(file).slice(1) || 'webp') {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await sharp({ create: { width: 64, height: 48, channels: 3, background: color } }).toFormat(ext).toFile(file);
}

export const hasFfmpeg = () => !!findFfmpeg();

/** A 1.5 second test-pattern mp4 (needs ffmpeg). */
export function writeVideo(file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const r = spawnSync(findFfmpeg(), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=15:duration=1.5',
        '-pix_fmt', 'yuv420p', file], { windowsHide: true });
    if (r.status !== 0) throw new Error('ffmpeg fixture failed: ' + r.stderr);
}

/** Every file under a folder (as base64), for before/after comparisons. */
export function snapshot(dir) {
    const out = {};
    (function walk(d) {
        for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else out[path.relative(dir, p).split(path.sep).join('/')] = fs.readFileSync(p).toString('base64');
        }
    })(dir);
    return out;
}
