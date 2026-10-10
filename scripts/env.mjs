// Minimal .env loader for the scripts in this folder (no dotenv dependency).
// Values already present in process.env win over the file.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export function loadEnv(file = '.env') {
  let text
  try {
    text = readFileSync(resolve(process.cwd(), file), 'utf8')
  } catch {
    return
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    // strip inline comments and surrounding quotes
    if (!/^["']/.test(value)) value = value.replace(/\s+#.*$/, '')
    value = value.replace(/^(["'])(.*)\1$/, '$2')
    if (!(key in process.env)) process.env[key] = value
  }
}

export function requireEnv(name, hint) {
  const v = process.env[name]
  if (!v) {
    console.error(`Missing ${name}.${hint ? ' ' + hint : ''}`)
    process.exit(1)
  }
  return v
}
