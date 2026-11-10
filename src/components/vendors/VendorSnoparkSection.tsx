import { Link } from 'react-router-dom'
import { Snowflake } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { supabase } from '@/lib/supabase'
import { ROUTES } from '@/lib/constants'
import { Badge } from '@/components/ui'

/** CA Snow Park's page points to the Sno-Park page: the season, the books on hand and the reports (Dana, Nov 5). */
export function VendorSnoparkSection({ vendorId }: { vendorId: string }) {
  const q = useSupabaseQuery(async () => {
    const { data, error } = await supabase.from('snopark_seasons').select('id, label, status').eq('vendor_id', vendorId).order('label', { ascending: false }).limit(1)
    if (error) throw error
    const season = data?.[0]
    if (!season) return null
    const { count } = await supabase.from('snopark_books').select('id', { count: 'exact', head: true }).eq('season_id', season.id).eq('status', 'on_hand')
    return { season, onHand: count ?? 0 }
  }, [vendorId])
  if (!q.data) return null
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500"><Snowflake className="size-4" aria-hidden="true" />Sno-Park passes</h2>
      <p className="mt-2 text-sm text-stone-700">Season {q.data.season.label} <Badge tone={q.data.season.status === 'open' ? 'success' : 'neutral'}>{q.data.season.status === 'open' ? 'Open' : 'Closed'}</Badge> · {q.data.onHand} book{q.data.onHand === 1 ? '' : 's'} on hand.</p>
      <Link to={ROUTES.snopark} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-foreground shadow-sm hover:bg-brand-hover"><Snowflake className="size-4" aria-hidden="true" />Open the permit submission page</Link>
      <p className="mt-2 text-xs text-stone-500">Receive books, the monthly submissions and the final report.</p>
    </section>
  )
}
