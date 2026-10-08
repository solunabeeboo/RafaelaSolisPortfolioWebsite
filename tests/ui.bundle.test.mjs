// The Vault UI must bundle cleanly (JSX, CSS imports, every module resolved).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');

test('src/vault-ui bundles with esbuild', async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-ui-'));
    try {
        const result = await build({
            entryPoints: [path.join(root, 'src/vault-ui/main.jsx')],
            outfile: path.join(out, 'app.js'),
            bundle: true, format: 'esm', target: 'es2022', jsx: 'automatic', jsxImportSource: 'preact',
            absWorkingDir: root, logLevel: 'silent', metafile: true,
        });
        assert.equal(result.errors.length, 0);
        assert.ok(fs.statSync(path.join(out, 'app.js')).size > 50_000, 'bundle has content');
        assert.ok(fs.existsSync(path.join(out, 'app.css')), 'styles are emitted next to the script');
        assert.ok(fs.existsSync(path.join(root, 'src/vault-ui/index.html')));
    } finally {
        fs.rmSync(out, { recursive: true, force: true });
    }
});
