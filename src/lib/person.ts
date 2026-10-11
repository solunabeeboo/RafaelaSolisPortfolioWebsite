// schema.org Person for Home/About JSON-LD (facts from the resumes)
import skills from '../content/skills.json';

// What search engines read as her expertise: the core disciplines, then every
// public skill from the vault, so this list never drifts from the About page.
const CORE = ['Game design', 'Systems design', 'Level design'];
const skillItems = (skills as { visibility?: string; items: string[] }[])
    .filter(s => s.visibility === 'public')
    .flatMap(s => s.items);

export const personJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: 'Rafaela Solís',
    alternateName: 'Rafaela X. Solís',
    jobTitle: 'Game Designer / Technical Designer',
    url: 'https://rafaelasolis.work/',
    image: 'https://rafaelasolis.work/headshot.jpg',
    email: 'mailto:rafa@miguelsolis.com',
    alumniOf: { '@type': 'CollegeOrUniversity', name: 'Champlain College', url: 'https://www.champlain.edu/' },
    worksFor: { '@type': 'Organization', name: 'Pentad Games' },
    knowsAbout: [...new Set([...CORE, ...skillItems])],
    sameAs: [
        'https://www.linkedin.com/in/rafaelasolis/',
        'https://github.com/solunabeeboo',
        'https://solunabeeboo.itch.io/',
        'https://bsky.app/profile/rafaelasolis.work',
    ],
};
