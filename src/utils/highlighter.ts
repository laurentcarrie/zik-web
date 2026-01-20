import { createHighlighter } from 'shiki';

export const highlighterPromise = createHighlighter({
    langs: ['jsx', 'js', 'yaml'],
    themes: ['min-dark', 'github-light']
});
