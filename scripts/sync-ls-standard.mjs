// Copy docs/lightspeed-category-standard.md into the Edge Functions (they cannot read the docs folder).
//   node scripts/sync-ls-standard.mjs
import { readFileSync, writeFileSync } from 'node:fs'
const text = readFileSync(new URL('../docs/lightspeed-category-standard.md', import.meta.url), 'utf8')
writeFileSync(new URL('../supabase/functions/_shared/lsStandard.ts', import.meta.url),
  `// Generated from docs/lightspeed-category-standard.md by scripts/sync-ls-standard.mjs (a test checks they match).\n// The LS category and naming standard Claude follows when it names new items on an LS PO.\nexport const LS_STANDARD = ${JSON.stringify(text)}\n`)
console.log('lsStandard.ts updated')
