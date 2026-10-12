import { describe, expect, it } from 'vitest'
import { mainScriptOf, newVersionLive, runningScript } from './newVersion'

const page = (name: string) => `<html><head><script type="module" crossorigin src="/assets/${name}"></script></head></html>`
const docWith = (name: string | null) => {
  const doc = document.implementation.createHTMLDocument('x')
  if (name) { const s = doc.createElement('script'); s.type = 'module'; s.src = `/assets/${name}`; doc.head.appendChild(s) }
  return doc
}
const fetching = (html: string, ok = true) => (async () => ({ ok, text: async () => html })) as unknown as typeof fetch

describe('new version check', () => {
  it('reads the main script', () => {
    expect(mainScriptOf(page('index-Yvcm7W5m.js'))).toBe('/assets/index-Yvcm7W5m.js')
    expect(mainScriptOf('<html></html>')).toBeNull()
    expect(runningScript(docWith('index-A.js'))).toBe('/assets/index-A.js')
  })
  it('says when the live page has moved on', async () => {
    expect(await newVersionLive(fetching(page('index-B.js')), docWith('index-A.js'))).toBe(true)
    expect(await newVersionLive(fetching(page('index-A.js')), docWith('index-A.js'))).toBe(false)
    expect(await newVersionLive(fetching(page('index-B.js'), false), docWith('index-A.js'))).toBe(false)
    expect(await newVersionLive(fetching(page('index-B.js')), docWith(null))).toBe(false)
  })
})
