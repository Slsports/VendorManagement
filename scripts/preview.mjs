// See screens the way Dana does, before or after a push: runs this checkout with Vite against the live
// Supabase project, signs in as the test login (VMS_TEST_EMAIL / VMS_TEST_PASSWORD) and saves screenshots
// at computer and phone size. Nothing is clicked or saved beyond signing in.
//   NODE_USE_ENV_PROXY=1 node scripts/preview.mjs /vendors /mail [--out dir] [--live]
//   --live: screenshot https://vms.shaverlakesports.com instead (needs that host allowed in the network policy)
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'
import { loadEnv, requireEnv } from './env.mjs'

loadEnv()
const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const paths = args.filter((a, i) => a.startsWith('/') && args[i - 1] !== '--out')
const out = opt('--out', join(process.env.TMPDIR ?? '/tmp', 'vms-preview'))
mkdirSync(out, { recursive: true })
const email = process.env.VMS_TEST_EMAIL
const password = process.env.VMS_TEST_PASSWORD
if (!email || !password) throw new Error('VMS_TEST_EMAIL / VMS_TEST_PASSWORD are not set in this session')

let base = 'https://vms.shaverlakesports.com'
let server
if (!flag('--live')) {
  const ref = requireEnv('SUPABASE_PROJECT_REF')
  const token = process.env.SUPABASE_ACCESS_TOKEN
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  const publishable = (await res.json()).find((k) => k.type === 'publishable')?.api_key // the browser key; never the secret one
  if (!publishable) throw new Error('No publishable key found')
  const port = 5199
  base = `http://localhost:${port}`
  server = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
    env: { ...process.env, VITE_SUPABASE_URL: `https://${ref}.supabase.co`, VITE_SUPABASE_ANON_KEY: publishable, VITE_APP_URL: base },
    stdio: 'ignore',
  })
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base)).ok) break } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500))
  }
}

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
try {
  for (const [label, viewport] of [['computer', { width: 1366, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: label === 'phone' ? 2 : 1 })
    await page.goto(`${base}/login`)
    await page.fill('#email', email)
    await page.fill('#password', password)
    await page.click('button[type=submit]')
    await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 })
    for (const p of paths.length ? paths : ['/']) {
      await page.goto(`${base}${p}`)
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.waitForTimeout(1500)
      const file = join(out, `${label}${p.replace(/[^a-z0-9]+/gi, '_') || '_home'}.png`)
      await page.screenshot({ path: file, fullPage: !flag('--viewport-only') })
      console.log(file)
    }
    await page.close()
  }
} finally {
  await browser.close()
  server?.kill()
}
