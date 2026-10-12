import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { newVersionLive } from '@/lib/newVersion'

const EVERY_MS = 5 * 60_000

/** "New version ready — tap to refresh" when VMS was updated after this copy loaded (checks every 5 minutes and on return). */
export function NewVersionBar() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (ready) return
    let stopped = false
    const check = () => { void newVersionLive().then((yes) => { if (yes && !stopped) setReady(true) }) }
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    const timer = window.setInterval(check, EVERY_MS)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', check)
    window.addEventListener('pageshow', check)
    check()
    return () => {
      stopped = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', check)
      window.removeEventListener('pageshow', check)
    }
  }, [ready])
  if (!ready) return null
  return (
    <button type="button" onClick={() => window.location.reload()}
      className="flex w-full items-center justify-center gap-2 bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90">
      <RefreshCw className="size-4" aria-hidden="true" /> A new version of VMS is ready. Tap here to refresh.
    </button>
  )
}
