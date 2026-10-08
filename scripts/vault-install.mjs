/**
 * One-time setup (`npm run vault:install`): Desktop and Start Menu shortcuts for
 * Vault, a Start Menu "Vault Capture" shortcut with the hotkey Ctrl+Alt+V, and
 * the icon they use. Never runs by itself.
 *
 *   node scripts/vault-install.mjs [--dry-run] [--ico-only] [--uninstall]
 *
 *   --dry-run     print what would be created, change nothing
 *   --ico-only    only write .vault/vault.ico
 *   --uninstall   remove the shortcuts
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LAUNCHER = path.join(REPO, 'scripts', 'vault-app.mjs');
const ICON = path.join(REPO, '.vault', 'vault.ico');
const flags = new Set(process.argv.slice(2));

const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
<rect width="256" height="256" rx="48" fill="#2d5016"/>
<path d="M62 70 128 192 194 70" fill="none" stroke="#f5f2eb" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** The site's favicon if it is a vector, otherwise a simple green tile; a 25px bitmap would blur at icon sizes. */
function iconSource() {
    const svg = path.join(REPO, 'public', 'favicon.svg');
    return fs.existsSync(svg) ? fs.readFileSync(svg) : Buffer.from(FALLBACK_SVG);
}

/** A multi-size .ico with PNG frames (supported since Windows Vista). */
async function buildIco() {
    const sizes = [16, 32, 48, 256];
    const frames = await Promise.all(sizes.map(s => sharp(iconSource(), { density: 384 }).resize(s, s).png().toBuffer()));
    const header = Buffer.alloc(6);
    header.writeUInt16LE(1, 2); // type: icon
    header.writeUInt16LE(frames.length, 4);
    let offset = 6 + 16 * frames.length;
    const entries = frames.map((png, i) => {
        const e = Buffer.alloc(16);
        e[0] = sizes[i] === 256 ? 0 : sizes[i];
        e[1] = sizes[i] === 256 ? 0 : sizes[i];
        e.writeUInt16LE(1, 4);  // colour planes
        e.writeUInt16LE(32, 6); // bits per pixel
        e.writeUInt32LE(png.length, 8);
        e.writeUInt32LE(offset, 12);
        offset += png.length;
        return e;
    });
    return Buffer.concat([header, ...entries, ...frames]);
}

const psQuote = s => `'${String(s).replace(/'/g, "''")}'`;

/** Run PowerShell without any quoting trouble by passing the script encoded. */
function powershell(script) {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
        { encoding: 'utf8', windowsHide: true }).trim();
}

const SHORTCUTS = [
    { name: 'Vault', where: ['Desktop', 'Programs'], args: [LAUNCHER], hotkey: '', description: 'Open Vault' },
    // A hotkey on two copies of the same shortcut is ambiguous, so only the Start Menu one has it
    { name: 'Vault Capture', where: ['Programs'], args: [LAUNCHER, '--capture'], hotkey: 'CTRL+ALT+V', description: 'Quick capture into the Vault inbox' },
];

function createScript() {
    const lines = [
        '$ErrorActionPreference = "Stop"',
        '$shell = New-Object -ComObject WScript.Shell',
        '$dirs = @{ Desktop = [Environment]::GetFolderPath("Desktop"); Programs = [Environment]::GetFolderPath("Programs") }',
    ];
    for (const s of SHORTCUTS) {
        for (const where of s.where) {
            lines.push(
                `$lnk = $shell.CreateShortcut((Join-Path $dirs.${where} ${psQuote(s.name + '.lnk')}))`,
                `$lnk.TargetPath = ${psQuote(process.execPath)}`,
                `$lnk.Arguments = ${psQuote(s.args.map(a => `"${a}"`).join(' '))}`,
                `$lnk.WorkingDirectory = ${psQuote(REPO)}`,
                '$lnk.WindowStyle = 7',
                `$lnk.IconLocation = ${psQuote(ICON + ',0')}`,
                `$lnk.Description = ${psQuote(s.description)}`,
                ...(s.hotkey ? [`$lnk.Hotkey = ${psQuote(s.hotkey)}`] : []),
                '$lnk.Save()',
                `Write-Output ("Created " + $lnk.FullName)`,
            );
        }
    }
    return lines.join('\n');
}

function removeScript() {
    const lines = ['$dirs = @{ Desktop = [Environment]::GetFolderPath("Desktop"); Programs = [Environment]::GetFolderPath("Programs") }'];
    for (const s of SHORTCUTS) {
        for (const where of s.where) {
            lines.push(`$p = Join-Path $dirs.${where} ${psQuote(s.name + '.lnk')}`, 'if (Test-Path $p) { Remove-Item $p; Write-Output ("Removed " + $p) }');
        }
    }
    return lines.join('\n');
}

async function main() {
    if (process.platform !== 'win32' && !flags.has('--dry-run') && !flags.has('--ico-only')) {
        throw new Error('vault:install creates Windows shortcuts and only runs on Windows.');
    }
    if (flags.has('--uninstall')) {
        if (flags.has('--dry-run')) return console.log('Would remove:\n' + SHORTCUTS.flatMap(s => s.where.map(w => `  ${s.name}.lnk (${w})`)).join('\n'));
        return console.log(powershell(removeScript()) || 'No Vault shortcuts found.');
    }

    const ico = await buildIco();
    if (flags.has('--dry-run')) {
        console.log(`Would write ${ICON} (${ico.length} bytes)`);
        console.log(`Would create shortcuts running: "${process.execPath}" "${LAUNCHER}"`);
        for (const s of SHORTCUTS) console.log(`  ${s.name} in ${s.where.join(' + ')}${s.hotkey ? `, hotkey ${s.hotkey}` : ''}`);
        return;
    }
    fs.mkdirSync(path.dirname(ICON), { recursive: true });
    fs.writeFileSync(ICON, ico);
    console.log(`Wrote ${ICON}`);
    if (flags.has('--ico-only')) return;

    console.log(powershell(createScript()));
    console.log('\nDone. To keep Vault on the taskbar, open it once, then right-click its taskbar icon and choose Pin.');
    console.log('Ctrl+Alt+V starts Quick Capture from anywhere once the Start Menu shortcut exists.');
}

main().catch(e => {
    console.error(e.message);
    process.exit(1);
});
