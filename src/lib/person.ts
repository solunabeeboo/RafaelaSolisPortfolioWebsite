// schema.org Person for Home/About JSON-LD (facts from the resumes)
export const personJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: 'Rafaela Solís',
    alternateName: 'Rafaela X. Solís',
    jobTitle: 'Game Designer',
    url: 'https://rafaelasolis.work/',
    image: 'https://rafaelasolis.work/headshot.jpg',
    email: 'mailto:rafa@miguelsolis.com',
    alumniOf: { '@type': 'CollegeOrUniversity', name: 'Champlain College', url: 'https://www.champlain.edu/' },
    worksFor: { '@type': 'Organization', name: 'Pentad Games' },
    knowsAbout: ['Game design', 'Systems design', 'Level design', 'C++', 'Lua', 'C#', 'Unreal Engine 5', 'Unity'],
    sameAs: [
        'https://www.linkedin.com/in/rafaelasolis/',
        'https://github.com/solunabeeboo',
        'https://solunabeeboo.itch.io/',
        'https://bsky.app/profile/rafaelasolis.work',
    ],
};
