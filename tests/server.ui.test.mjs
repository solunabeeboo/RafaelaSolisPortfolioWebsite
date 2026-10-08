import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, makeVault, makeSite, startServer } from './server-helpers.mjs';

// The real Vault screens (src/vault-ui) must bundle and be served.
test('the real UI bundles and is served', { skip: !fs.existsSync(path.join(REPO, 'src/vault-ui/main.jsx')) && 'src/vault-ui not built yet' }, async () => {
    const server = await startServer({
        port: 4345, vaultDir: makeVault(), siteDir: makeSite().dir,
        env: { VAULT_UI_SRC: path.join(REPO, 'src/vault-ui') },
    });
    try {
        const page = await server.get('/');
        assert.equal(page.status, 200, page.text.slice(0, 500));
        assert.match(page.text, /<script[^>]+src="\/app\.js"/);
        const js = await server.get('/app.js');
        assert.equal(js.status, 200);
        assert.ok(js.text.length > 5000);
        assert.equal((await server.get('/capture')).status, 200);
    } finally { await server.stop(); }
});
