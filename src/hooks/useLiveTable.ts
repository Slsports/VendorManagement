import { useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'

/**
 * Refresh when rows of a table change, whoever changed them (Dana, Oct 19: "all documents folders should refresh itself
 * when any doc lands in there"). Supabase Realtime sends the change (RLS decides what each person hears); bursts are
 * folded into one refresh. `filter` is Realtime's form, e.g. "vendor_id=eq.<id>"; null means the whole table.
 */
export function useLiveTable(table: string, filter: string | null, onChange: () => void, enabled = true) {
  const cb = useRef(onChange)
  useEffect(() => { cb.current = onChange })
  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const channel = supabase
      .channel(`live:${table}:${filter ?? 'all'}:${Math.random().toString(36).slice(2)}`)
      .on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, () => {
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => { timer = null; cb.current() }, 400)
      })
      .subscribe()
    return () => { if (timer) clearTimeout(timer); void supabase.removeChannel(channel) }
  }, [table, filter, enabled])
}
