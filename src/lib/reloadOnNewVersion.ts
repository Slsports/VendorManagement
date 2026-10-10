// Pages load in pieces as you move around. When a new version goes live, the old pieces are gone, so a tab
// opened before the update cannot load the next page and showed a blank screen. Reload once instead; if
// the reload itself just happened, let the error through rather than loop.
const KEY = 'vms:reloaded-for-new-version'
const WINDOW_MS = 10_000

export function reloadOnNewVersion(win: Window = window, now: () => number = Date.now) {
  win.addEventListener('vite:preloadError', (event) => {
    let last = 0
    try { last = Number(win.sessionStorage.getItem(KEY) ?? 0) } catch { /* storage blocked */ }
    if (now() - last < WINDOW_MS) return
    try { win.sessionStorage.setItem(KEY, String(now())) } catch { /* storage blocked */ }
    event.preventDefault()
    win.location.reload()
  })
}
