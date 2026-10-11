import { parseArticle, slugOf, type HelpArticle } from './help'

// Every file in docs/help, read in when the app is built (so the help always matches the version running).
const files = import.meta.glob('../../docs/help/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

export const helpArticles: HelpArticle[] = Object.entries(files).map(([path, raw]) => parseArticle(slugOf(path), raw))
