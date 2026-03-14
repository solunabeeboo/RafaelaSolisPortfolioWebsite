import { defineConfig } from 'astro/config';
import fs   from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Vite plugin — adds /api/projects (GET/POST) and /api/upload (POST) in dev only */
function devAdminPlugin() {
    return {
        name: 'dev-admin',
        configureServer(server) {
            const PROJECTS_PATH = path.join(__dirname, 'src/data/projects.json');
            const UPLOADS_DIR   = path.join(__dirname, 'public/projects/uploads');

            function readBody(req) {
                return new Promise((resolve, reject) => {
                    let body = '';
                    req.on('data', chunk => { body += chunk; });
                    req.on('end', () => {
                        try { resolve(JSON.parse(body)); }
                        catch (e) { reject(e); }
                    });
                });
            }

            server.middlewares.use('/api/projects', async (req, res, next) => {
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                try {
                    if (req.method === 'GET') {
                        const data = fs.readFileSync(PROJECTS_PATH, 'utf-8');
                        res.statusCode = 200;
                        res.end(data);
                    } else if (req.method === 'POST') {
                        const body = await readBody(req);
                        fs.writeFileSync(PROJECTS_PATH, JSON.stringify(body, null, 2));
                        res.statusCode = 200;
                        res.end(JSON.stringify({ ok: true }));
                    } else {
                        next();
                    }
                } catch (e) {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: String(e) }));
                }
            });

            server.middlewares.use('/api/upload', async (req, res, next) => {
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Access-Control-Allow-Origin', '*');
                try {
                    if (req.method === 'POST') {
                        const body = await readBody(req);
                        // body: { subfolder: 'images'|'screenshots'|'uploads', filename: 'xxx.png', data: 'data:...;base64,...' }
                        const sub  = (body.subfolder || 'uploads').replace(/[^a-z0-9_-]/gi, '');
                        const dir  = path.join(__dirname, 'public/projects', sub);
                        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                        const safe = path.basename(body.filename).replace(/[^a-z0-9._\-() ]/gi, '_');
                        const base64 = body.data.replace(/^data:[^;]+;base64,/, '');
                        fs.writeFileSync(path.join(dir, safe), Buffer.from(base64, 'base64'));
                        res.statusCode = 200;
                        res.end(JSON.stringify({ ok: true, path: `${sub}/${safe}` }));
                    } else {
                        next();
                    }
                } catch (e) {
                    res.statusCode = 500;
                    res.end(JSON.stringify({ error: String(e) }));
                }
            });
        }
    };
}

export default defineConfig({
    site: 'https://rafaelasolis.work',
    output: 'static',
    vite: {
        plugins: [devAdminPlugin()]
    }
});
