#!/usr/bin/env node
/**
 * optimize-images.mjs
 *
 * Optimizes portfolio images: resizes to display dimensions, converts to WebP,
 * and updates projects.json filename references.
 *
 * Usage (from your portfolio repo root):
 *   node optimize-images.mjs              # actually run
 *   node optimize-images.mjs --dry        # preview without changes
 *   node optimize-images.mjs --quality=85 # tune quality (default 82)
 *
 * Setup (one-time):
 *   npm install --save-dev sharp
 *
 * Sizing rules (priority order):
 *   1. Per-file overrides in FILE_OVERRIDES below
 *   2. Screenshot rule: anything wider than 1600px gets capped at 1400px
 *   3. Hard ceiling: 2400px for everything else
 */

import sharp from 'sharp';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ─── Configuration ─────────────────────────────────────────────────────────

const PROJECT_ROOT = process.cwd();

const IMAGE_DIRS = [
  'public/projects/screenshots',
  'public/projects/images',
];

const BACKUP_DIR = 'public/projects/_originals_backup';
const PROJECTS_JSON = 'src/data/projects.json';

// Per-file sizing overrides. Filename match is case-insensitive.
const FILE_OVERRIDES = {
  'headshot.jpg':    { width: 460,  note: 'displayed ~230px, 2x for retina' },
  'headshot.png':    { width: 460,  note: 'displayed ~230px, 2x for retina' },
  'levelmockup.png': { width: 1200, note: 'wide level mockup' },
  'levelmockup.jpg': { width: 1200, note: 'wide level mockup' },
};

const SCREENSHOT_THRESHOLD = 1600; // wider than this triggers screenshot rule
const SCREENSHOT_CAP = 1400;       // resize down to this
const HARD_MAX_WIDTH = 2400;       // ceiling for anything else

// ─── CLI args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry') || args.includes('--dry-run');
const SKIP_BACKUP = args.includes('--skip-backup');
const QUALITY = (() => {
  const arg = args.find(a => a.startsWith('--quality='));
  return arg ? parseInt(arg.split('=')[1], 10) : 82;
})();

// ─── Pretty output helpers ─────────────────────────────────────────────────

const c = {
  reset:  '\x1b[0m',
  cyan:   '\x1b[36m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  gray:   '\x1b[90m',
  dim:    '\x1b[2m',
};
const fmt = (color, s) => `${c[color]}${s}${c.reset}`;

const formatBytes = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

// ─── Image discovery ───────────────────────────────────────────────────────

async function findImages() {
  const found = [];
  for (const dir of IMAGE_DIRS) {
    const fullDir = path.join(PROJECT_ROOT, dir);
    try {
      await walk(fullDir, found);
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.log(fmt('yellow', `  Directory not found, skipping: ${dir}`));
      } else {
        throw err;
      }
    }
  }
  return found;
}

async function walk(dir, accumulator) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, accumulator);
    } else if (/\.(png|jpe?g)$/i.test(entry.name)) {
      accumulator.push(full);
    }
  }
}

// ─── Sizing rules ──────────────────────────────────────────────────────────

function decideTargetWidth(filename, currentWidth) {
  const lower = filename.toLowerCase();
  if (FILE_OVERRIDES[lower]) {
    const o = FILE_OVERRIDES[lower];
    return { width: o.width, reason: `override: ${o.note}` };
  }
  if (currentWidth > SCREENSHOT_THRESHOLD) {
    return { width: SCREENSHOT_CAP, reason: `screenshot rule (>${SCREENSHOT_THRESHOLD}px)` };
  }
  if (currentWidth > HARD_MAX_WIDTH) {
    return { width: HARD_MAX_WIDTH, reason: 'hard max width' };
  }
  return { width: currentWidth, reason: 'no resize needed' };
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(fmt('cyan', '\n=== Portfolio Image Optimizer ===\n'));
  console.log(`Project root:        ${PROJECT_ROOT}`);
  console.log(`Quality:             ${QUALITY}`);
  console.log(`Hard max width:      ${HARD_MAX_WIDTH}px`);
  console.log(`Screenshot rule:     >${SCREENSHOT_THRESHOLD}px wide -> ${SCREENSHOT_CAP}px`);
  console.log(`Per-file overrides:  ${Object.keys(FILE_OVERRIDES).length}`);
  console.log(`Dry run:             ${DRY_RUN}\n`);

  const images = await findImages();
  if (images.length === 0) {
    console.log(fmt('yellow', 'No PNG/JPG images found.'));
    return;
  }
  console.log(fmt('cyan', `Found ${images.length} image(s) to process.\n`));

  // Backup originals
  if (!DRY_RUN && !SKIP_BACKUP) {
    const backupRoot = path.join(PROJECT_ROOT, BACKUP_DIR);
    await fs.mkdir(backupRoot, { recursive: true });
    for (const img of images) {
      const rel = path.relative(path.join(PROJECT_ROOT, 'public/projects'), img);
      const dest = path.join(backupRoot, rel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      try {
        await fs.access(dest); // already backed up
      } catch {
        await fs.copyFile(img, dest);
      }
    }
    console.log(fmt('green', `Originals backed up to: ${BACKUP_DIR}\n`));
  }

  let totalBefore = 0;
  let totalAfter = 0;
  const conversions = {}; // oldName -> newName
  const failed = [];

  for (const imgPath of images) {
    const filename = path.basename(imgPath);
    const stat = await fs.stat(imgPath);
    const sizeBefore = stat.size;
    totalBefore += sizeBefore;

    let metadata;
    try {
      metadata = await sharp(imgPath).metadata();
    } catch (err) {
      console.log(`  ${filename} ${fmt('red', 'FAILED to read metadata: ' + err.message)}`);
      failed.push(imgPath);
      totalAfter += sizeBefore;
      continue;
    }

    const currentWidth = metadata.width;
    const { width: targetWidth, reason } = decideTargetWidth(filename, currentWidth);

    process.stdout.write(`  ${filename} `);
    process.stdout.write(fmt('gray', `(${formatBytes(sizeBefore)}, ${currentWidth}px) `));
    process.stdout.write(fmt('cyan', `-> ${targetWidth}px `));
    process.stdout.write(fmt('gray', `[${reason}]`));

    if (DRY_RUN) {
      console.log(fmt('yellow', '  [dry run]'));
      continue;
    }

    const outPath = imgPath.replace(/\.(png|jpe?g)$/i, '.webp');

    try {
      await sharp(imgPath)
        .resize({ width: targetWidth, withoutEnlargement: true })
        .webp({ quality: QUALITY })
        .toFile(outPath);

      const sizeAfter = (await fs.stat(outPath)).size;
      totalAfter += sizeAfter;
      const savings = ((1 - sizeAfter / sizeBefore) * 100).toFixed(1);

      console.log(`\n    -> ${formatBytes(sizeAfter)} ${fmt('green', `(-${savings}%)`)}`);

      conversions[filename] = filename.replace(/\.(png|jpe?g)$/i, '.webp');

      // Delete original now that backup exists and webp is written
      await fs.unlink(imgPath);
    } catch (err) {
      console.log(fmt('red', `\n    FAILED: ${err.message}`));
      failed.push(imgPath);
      totalAfter += sizeBefore;
    }
  }

  // Update projects.json
  const jsonPath = path.join(PROJECT_ROOT, PROJECTS_JSON);
  if (!DRY_RUN && Object.keys(conversions).length > 0) {
    try {
      const original = await fs.readFile(jsonPath, 'utf8');
      await fs.writeFile(jsonPath + '.bak', original);
      console.log(fmt('cyan', '\nUpdating projects.json...'));
      console.log(fmt('gray', `  Backup: ${PROJECTS_JSON}.bak`));

      let updated = original;
      let totalReplacements = 0;
      for (const [oldName, newName] of Object.entries(conversions)) {
        const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(escaped, 'g');
        const count = (updated.match(re) || []).length;
        if (count > 0) {
          updated = updated.replace(re, newName);
          totalReplacements += count;
          console.log(fmt('gray', `  ${oldName} -> ${newName} (${count} ref${count === 1 ? '' : 's'})`));
        }
      }

      if (totalReplacements > 0) {
        await fs.writeFile(jsonPath, updated);
        console.log(fmt('green', `  Updated ${totalReplacements} reference(s).`));
      } else {
        console.log(fmt('yellow', '  No references found in projects.json.'));
      }
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.log(fmt('yellow', `\nprojects.json not found at: ${PROJECTS_JSON}`));
        console.log(fmt('yellow', "Update image references manually."));
      } else {
        throw err;
      }
    }
  }

  // Summary
  console.log(fmt('cyan', '\n=== Summary ==='));
  console.log(`Images processed: ${images.length}`);
  console.log(`Before: ${formatBytes(totalBefore)}`);
  console.log(`After:  ${formatBytes(totalAfter)}`);
  if (totalBefore > 0) {
    const pct = ((1 - totalAfter / totalBefore) * 100).toFixed(1);
    console.log(fmt('green', `Saved:  ${formatBytes(totalBefore - totalAfter)} (${pct}%)`));
  }

  if (failed.length > 0) {
    console.log(fmt('red', '\nFailed:'));
    failed.forEach(f => console.log(fmt('red', `  ${f}`)));
  }

  if (!DRY_RUN) {
    console.log('\nNext steps:');
    console.log('  1. npm run dev (or build) and verify images load');
    console.log(`  2. Diff ${PROJECTS_JSON} against ${PROJECTS_JSON}.bak`);
    console.log(`  3. Once verified, you can delete ${BACKUP_DIR}`);
    console.log('  4. Commit and deploy\n');
  }
}

main().catch(err => {
  console.error(fmt('red', '\nFatal error:'), err);
  process.exit(1);
});
