import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { countMailForMe } from '@/services/mail'

/** Threads waiting on the signed-in person, refreshed every minute (the number on Mail in the side menu). */
export function useMailCount(): number {
  const { organization, profile, role } = useAuth()
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!organization || !profile || role === 'uploader') return
    let alive = true
    const load = () => countMailForMe(organization.id, profile.id, profile.sees_freight).then((n) => { if (alive) setCount(n) }).catch(() => {})
    void load()
    const timer = window.setInterval(load, 60_000)
    return () => { alive = false; window.clearInterval(timer) }
  }, [organization, profile, role])
  return count
}
