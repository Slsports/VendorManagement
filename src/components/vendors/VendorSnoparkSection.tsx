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
      <p className="mt-2 text-sm text-stone-700">Season {q.data.season.label} <Badge tone={q.data.season.status === 'open' ? 'success' : 'neutral'}>{q.data.season.status === 'open' ? 'Open' : 'Closed'}</Badge> · {q.data.onHand} book{q.data.onHand === 1 ? '' : 's'} on hand. <Link to={ROUTES.snopark} className="text-brand hover:underline">Books and reports</Link></p>
    </section>
  )
}
