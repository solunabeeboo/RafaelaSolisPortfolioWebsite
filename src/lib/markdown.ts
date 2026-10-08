// Markdown for text fields (problem, goal, result...) that are not whole files.
import { createMarkdownProcessor } from '@astrojs/markdown-remark';

let processor: ReturnType<typeof createMarkdownProcessor> | undefined;

export async function renderMarkdown(md?: string): Promise<string> {
    if (!md?.trim()) return '';
    processor ??= createMarkdownProcessor({ syntaxHighlight: false });
    return (await (await processor).render(md)).code;
}
