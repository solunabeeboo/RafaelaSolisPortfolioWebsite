/**
 * Prerender a resume PDF for the public /resume/ page, so the browser never
 * needs pdf.js:
 *   - page images: Ghostscript at 150 dpi -> sharp -> near-lossless WebP
 *     (falls back to pdfjs + @napi-rs/canvas when Ghostscript is missing)
 *   - a text + link layer (positions as % of the page) from pdfjs-dist, for
 *     invisible selectable text and clickable link hotspots.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { findGhostscript } from './media.mjs';

const PAGE_WIDTH = 1275;
const DPI = 150;

let pdfjsPromise;
const loadPdfjs = () => (pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs'));

const pct = (n, of) => Math.round((n / of) * 10000) / 100;

/** Text runs and link rectangles for every page, positions in percent of the page. */
export async function extractLayers(pdfBytes) {
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBytes), verbosity: 0 }).promise;
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const vp = page.getViewport({ scale: 1 });

        const text = [];
        for (const item of (await page.getTextContent()).items) {
            if (!('str' in item) || !item.str.trim()) continue;
            // Baseline-left corner in viewport space (y grows downward)
            const [, , , , x, baseline] = pdfjs.Util.transform(vp.transform, item.transform);
            const h = item.height || Math.hypot(item.transform[2], item.transform[3]);
            text.push({ s: item.str, x: pct(x, vp.width), y: pct(baseline - h, vp.height), w: pct(item.width, vp.width), h: pct(h, vp.height) });
        }

        const links = [];
        for (const a of await page.getAnnotations()) {
            const url = a.url || a.unsafeUrl;
            if (a.subtype !== 'Link' || !url) continue;
            const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
            links.push({
                url,
                x: pct(Math.min(x1, x2), vp.width), y: pct(Math.min(y1, y2), vp.height),
                w: pct(Math.abs(x2 - x1), vp.width), h: pct(Math.abs(y2 - y1), vp.height),
            });
        }
        pages.push({ text, links });
    }
    await doc.destroy();
    return pages;
}

async function renderWithGhostscript(gs, pdfFile, tmpDir) {
    const { execFile } = await import('node:child_process');
    await new Promise((resolve, reject) => execFile(gs, [
        '-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=png16m', `-r${DPI}`,
        '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4',
        `-sOutputFile=${path.join(tmpDir, 'p-%d.png')}`, pdfFile,
    ], { windowsHide: true }, (err, _o, stderr) => (err ? reject(new Error(`Ghostscript failed: ${stderr || err.message}`)) : resolve())));
    return fs.readdirSync(tmpDir).filter(f => /^p-\d+\.png$/.test(f))
        .sort((a, b) => parseInt(a.slice(2)) - parseInt(b.slice(2)))
        .map(f => fs.readFileSync(path.join(tmpDir, f)));
}

async function renderWithCanvas(pdfBytes) {
    let canvasMod;
    try { canvasMod = await import('@napi-rs/canvas'); }
    catch { throw new Error('Resume prerender needs Ghostscript (gswin64c/gswin32c, or set GS) or the @napi-rs/canvas package.'); }
    const pdfjs = await loadPdfjs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBytes), verbosity: 0, isEvalSupported: false }).promise;
    const out = [];
    for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const vp = page.getViewport({ scale: DPI / 72 });
        const canvas = canvasMod.createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise;
        out.push(canvas.toBuffer('image/png'));
    }
    await doc.destroy();
    return out;
}

/**
 * Render a PDF to WebP page images in `outDir` as `<id>-p<n>.webp`.
 * Returns `{ pages: [{ file, width, height }], renderer }`.
 */
export async function renderPages(pdfFile, id, outDir) {
    const pdfBytes = fs.readFileSync(pdfFile);
    const gs = findGhostscript();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resume-'));
    try {
        const pngs = gs ? await renderWithGhostscript(gs, pdfFile, tmpDir) : await renderWithCanvas(pdfBytes);
        fs.mkdirSync(outDir, { recursive: true });
        const pages = [];
        for (const [i, png] of pngs.entries()) {
            const file = `${id}-p${i + 1}.webp`;
            const info = await sharp(png).resize({ width: PAGE_WIDTH })
                .webp({ nearLossless: true, quality: 60, effort: 6 }).toFile(path.join(outDir, file));
            pages.push({ file, width: info.width, height: info.height });
        }
        return { pages, renderer: gs ? 'ghostscript' : 'pdfjs+canvas' };
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}
