// A new version of VMS is live (Dana, Oct 12: the iPad kept showing an old copy). The app loads once and keeps
// running, so it checks every few minutes, and when you come back to it, whether the live page points at a newer
// main script than the one running, and offers a refresh.

/** The main script a page loads: "/assets/index-Yvcm7W5m.js" (null when there is none, e.g. in development). */
export function mainScriptOf(html: string): string | null {
  return html.match(/<script[^>]+src="([^"]*\/assets\/index-[^"]+\.js)"/)?.[1] ?? null
}

/** The main script this copy of the app was loaded from. */
export function runningScript(doc: Document = document): string | null {
  const el = doc.querySelector<HTMLScriptElement>('script[type="module"][src*="/assets/index-"]')
  const src = el?.getAttribute('src')
  return src ? new URL(src, 'https://vms.invalid').pathname : null
}

/** True when the live page loads a different main script than the running one. */
export async function newVersionLive(fetcher: typeof fetch = fetch, doc: Document = document): Promise<boolean> {
  const running = runningScript(doc)
  if (!running) return false
  try {
    const res = await fetcher(`/?version-check=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return false
    const live = mainScriptOf(await res.text())
    return !!live && live !== running
  } catch {
    return false
  }
}
