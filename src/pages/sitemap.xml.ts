import type { APIRoute } from 'astro';
import { getProjects } from '../lib/content';

// Built from the published content, so new public projects are listed
// automatically. /for/* recruiter pages are intentionally left out.
export const GET: APIRoute = async ({ site }) => {
    const paths = ['/', '/projects/', '/about/', '/resume/', '/contact/',
        ...(await getProjects()).map(p => `/projects/${p.id}/`)];
    const urls = paths.map(p => `  <url><loc>${new URL(p, site).href}</loc></url>`).join('\n');
    return new Response(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
        { headers: { 'Content-Type': 'application/xml' } },
    );
};
