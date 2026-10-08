/**
 * Media processing for the vault: images through sharp, videos through ffmpeg.
 * Used by uploads (vault server), the one-time migration, and publish.
 *
 * Every long operation takes an optional `onProgress(pct, message)` callback.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import sharp from 'sharp';
import { defaultPosterRel } from '../src/lib/media.mjs';

export const IMAGE_MAX_WIDTH = 2400;
export const VIDEO_MAX_WIDTH = 1280;
export const POSTER_WIDTH = 1280;

// ── Locating tools ────────────────────────────────────────────────────────

function findExecutable(names, extraDirs = []) {
    const dirs = [...(process.env.PATH ?? '').split(path.delimiter), ...extraDirs].filter(Boolean);
    const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
    for (const dir of dirs) {
        for (const name of names) {
            for (const ext of exts) {
                const p = path.join(dir, name + ext);
                if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
            }
        }
    }
    return null;
}

const globDirs = (parent, suffix) =>
    fs.existsSync(parent) ? fs.readdirSync(parent).map(d => path.join(parent, d, suffix)) : [];

let cache = {};
const memo = (key, fn) => (key in cache ? cache[key] : (cache[key] = fn()));
/** Forget located tools (tests change PATH/env). */
export const resetToolCache = () => { cache = {}; };

export const findFfmpeg = () => memo('ffmpeg', () =>
    process.env.FFMPEG || findExecutable(['ffmpeg'], ['C:/ffmpeg/bin']));
export const findFfprobe = () => memo('ffprobe', () =>
    process.env.FFPROBE || findExecutable(['ffprobe'], [path.dirname(findFfmpeg() ?? ''), 'C:/ffmpeg/bin']));

/** Ghostscript: PATH, then the usual install locations (the installer here is 32-bit). */
export const findGhostscript = () => memo('gs', () => {
    if (process.env.GS) return process.env.GS;
    const dirs = ['C:/Program Files/gs', 'C:/Program Files (x86)/gs'].flatMap(p => globDirs(p, 'bin'));
    return findExecutable(['gswin64c', 'gswin32c', 'gs'], dirs);
});

// ── Process helpers ───────────────────────────────────────────────────────

function run(cmd, args, { onStdoutLine, input } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(cmd, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
        const out = [];
        let err = '', pending = '';
        child.stdout.on('data', chunk => {
            if (!onStdoutLine) return void out.push(chunk);
            pending += chunk;
            const lines = pending.split(/\r?\n/);
            pending = lines.pop();
            lines.forEach(onStdoutLine);
        });
        child.stderr.on('data', c => { err = (err + c).slice(-4000); });
        child.on('error', reject);
        child.on('close', code => code === 0
            ? resolve(Buffer.concat(out))
            : reject(new Error(`${path.basename(cmd)} exited ${code}: ${err.trim().split('\n').slice(-3).join(' ')}`)));
        child.stdin.on('error', () => {});
        child.stdin.end(input);
    });
}

function requireTool(path_, name) {
    if (!path_) throw new Error(`${name} not found. Install it or set the ${name.toUpperCase()} environment variable.`);
    return path_;
}

// ── Images ────────────────────────────────────────────────────────────────

/**
 * Re-encode any raster image as WebP q82, longest side capped, EXIF rotation applied.
 * `input` is a path or Buffer. Writes `out` (should end in .webp).
 */
export async function processImage(input, out, { maxWidth = IMAGE_MAX_WIDTH, onProgress } = {}) {
    onProgress?.(10, 'Converting image');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const info = await sharp(input)
        .rotate()
        .resize({ width: maxWidth, height: maxWidth, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(out);
    onProgress?.(100, 'Done');
    return { path: out, bytes: info.size, width: info.width, height: info.height };
}

export async function probeImage(file) {
    const m = await sharp(file).metadata();
    return { width: m.width, height: m.height, bytes: fs.statSync(file).size };
}

// ── Video ─────────────────────────────────────────────────────────────────

/** `{ width, height, duration, hasAudio, bytes }` for a video file. */
export async function probeVideo(file) {
    const ffprobe = requireTool(findFfprobe(), 'ffprobe');
    const json = JSON.parse((await run(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file])).toString());
    const v = json.streams.find(s => s.codec_type === 'video');
    if (!v) throw new Error(`${path.basename(file)} has no video stream`);
    const duration = parseFloat(json.format?.duration ?? v.duration);
    return {
        width: v.width,
        height: v.height,
        duration: Number.isFinite(duration) ? duration : null,
        hasAudio: json.streams.some(s => s.codec_type === 'audio'),
        bytes: fs.statSync(file).size,
    };
}

/** Frame at `at` seconds (clamped into the clip) as a WebP poster. */
export async function makePoster(videoFile, posterFile, { at = 1, duration } = {}) {
    const ffmpeg = requireTool(findFfmpeg(), 'ffmpeg');
    const info = duration === undefined ? await probeVideo(videoFile) : { duration };
    const t = info.duration && info.duration < at + 0.5 ? Math.max(0, info.duration / 2) : at;
    const png = await run(ffmpeg, ['-v', 'error', '-ss', String(t), '-i', videoFile, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-']);
    fs.mkdirSync(path.dirname(posterFile), { recursive: true });
    const out = await sharp(png).resize({ width: POSTER_WIDTH, withoutEnlargement: true }).webp({ quality: 80 }).toFile(posterFile);
    return { path: posterFile, bytes: out.size, width: out.width, height: out.height };
}

/**
 * Transcode to web H.264 (<= 1280 wide, faststart, AAC 96k or no audio) and
 * write a poster beside it. `posterFile` defaults to `<name>.poster.webp`.
 */
export async function processVideo(input, out, { onProgress, posterFile, maxWidth = VIDEO_MAX_WIDTH } = {}) {
    const ffmpeg = requireTool(findFfmpeg(), 'ffmpeg');
    const src = await probeVideo(input);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const tmp = out + '.part.mp4';

    const args = [
        '-y', '-v', 'error', '-nostats', '-progress', 'pipe:1', '-i', input,
        '-vf', `scale='min(${maxWidth},iw)':-2`,
        '-c:v', 'libx264', '-crf', '26', '-preset', 'slow', '-movflags', '+faststart', '-pix_fmt', 'yuv420p',
        ...(src.hasAudio ? ['-c:a', 'aac', '-b:a', '96k'] : ['-an']),
        tmp,
    ];
    onProgress?.(0, 'Encoding video');
    try {
        await run(ffmpeg, args, {
            onStdoutLine(line) {
                const m = line.match(/^out_time_(?:us|ms)=(\d+)/);
                if (m && src.duration) {
                    // ffmpeg reports microseconds under both key names
                    const pct = Math.min(95, Math.round((Number(m[1]) / 1e6 / src.duration) * 95));
                    onProgress?.(pct, 'Encoding video');
                }
            },
        });
        fs.renameSync(tmp, out);
    } finally {
        fs.rmSync(tmp, { force: true });
    }

    onProgress?.(96, 'Making poster');
    const info = await probeVideo(out);
    const poster = posterFile ?? path.join(path.dirname(out), path.basename(defaultPosterRel(path.basename(out))));
    const p = await makePoster(out, poster, { duration: info.duration });
    onProgress?.(100, 'Done');
    return { path: out, bytes: info.bytes, width: info.width, height: info.height, duration: info.duration, poster: p.path, posterBytes: p.bytes };
}

/** GIF to MP4 (same encoder settings, GIFs have no audio). */
export const gifToMp4 = (input, out, opts) => processVideo(input, out, opts);

// ── Ingest: one entry point for uploads ───────────────────────────────────

const RASTER_RE = /\.(png|jpe?g|webp|bmp|tiff?|avif|heic)$/i;
const VIDEO_RE = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;

/**
 * Process an uploaded file into `destDir`:
 *   raster image  -> <stem>.webp
 *   gif / video   -> <stem>.mp4 + <stem>.poster.webp  (original kept under originalsDir)
 *   anything else -> rejected
 * Returns the vault-relative-ready file info (caller maps destDir to a `src`).
 */
export async function ingest(inputFile, { destDir, stem, originalsDir, onProgress }) {
    const ext = path.extname(inputFile).toLowerCase();
    stem ||= path.basename(inputFile, path.extname(inputFile));
    fs.mkdirSync(destDir, { recursive: true });

    if (RASTER_RE.test(ext)) {
        const out = path.join(destDir, stem + '.webp');
        const r = await processImage(inputFile, out, { onProgress });
        return { kind: 'image', file: path.basename(out), bytes: r.bytes, width: r.width, height: r.height };
    }
    if (ext === '.gif' || VIDEO_RE.test(ext)) {
        const out = path.join(destDir, stem + '.mp4');
        if (originalsDir) {
            fs.mkdirSync(originalsDir, { recursive: true });
            fs.copyFileSync(inputFile, path.join(originalsDir, stem + ext));
        }
        const r = await processVideo(inputFile, out, { onProgress });
        return {
            kind: 'video', file: path.basename(out), poster: path.basename(r.poster),
            bytes: r.bytes, width: r.width, height: r.height, duration: r.duration,
        };
    }
    throw new Error(`Unsupported file type "${ext || path.basename(inputFile)}". Use an image, GIF, or video.`);
}
