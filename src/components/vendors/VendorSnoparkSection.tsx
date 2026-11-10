import { Link } from 'react-router-dom'
import { FileText, Folder, Snowflake } from 'lucide-react'
import toast from 'react-hot-toast'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { supabase } from '@/lib/supabase'
import { signedFileUrl } from '@/services/lines'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import { Badge } from '@/components/ui'
import type { VendorLinkKind } from '@/types'

// Dana's season folders (Nov 10): "everything is listed under each year with all the corresponding folders"
const SEASON_FOLDERS: { label: string; kinds: VendorLinkKind[] }[] = [
  { label: 'Vendor Packet', kinds: ['snopark_packet_doc', 'snopark_agreement', 'snopark_form'] },
  { label: 'Orders', kinds: ['order', 'snopark_sheet'] },
  { label: 'Payment Submissions', kinds: ['snopark_packet', 'snopark_report', 'snopark_print', 'snopark_scan'] },
  { label: 'Final Report', kinds: ['snopark_final_packet'] },
]

/** CA Snow Park's page points to the Sno-Park page: the season, the books on hand and the reports (Dana, Nov 5). */
export function VendorSnoparkSection({ vendorId }: { vendorId: string }) {
  const q = useSupabaseQuery(async () => {
    const { data, error } = await supabase.from('snopark_seasons').select('id, label, status, flowchart_link_id').eq('vendor_id', vendorId).order('label', { ascending: false }).limit(1)
    if (error) throw error
    const season = data?.[0]
    if (!season) return null
    const { count } = await supabase.from('snopark_books').select('id', { count: 'exact', head: true }).eq('season_id', season.id).eq('status', 'on_hand')
    const { data: files } = await supabase.from('vendor_links').select('id, kind, file_name, label, storage_path, season_label, created_at').eq('vendor_id', vendorId).eq('is_current', true).not('season_label', 'is', null).not('storage_path', 'is', null).order('created_at')
    const flowchart = season.flowchart_link_id ? (files ?? []).find((f) => f.id === season.flowchart_link_id) ?? null : null
    return { season, onHand: count ?? 0, files: files ?? [], flowchart }
  }, [vendorId])
  async function open(path: string | null) {
    if (!path) return
    try { window.open(await signedFileUrl(path), '_blank', 'noopener') } catch (e) { toast.error(errorMessage(e)) }
  }
  if (!q.data) return null
  const seasons = [...new Set(q.data.files.map((f) => f.season_label!))].sort().reverse()
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-stone-500"><Snowflake className="size-4" aria-hidden="true" />Sno-Park passes</h2>
      <p className="mt-2 text-sm text-stone-700">Season {q.data.season.label} <Badge tone={q.data.season.status === 'open' ? 'success' : 'neutral'}>{q.data.season.status === 'open' ? 'Open' : 'Closed'}</Badge> · {q.data.onHand} book{q.data.onHand === 1 ? '' : 's'} on hand.</p>
      <Link to={ROUTES.snopark} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-foreground shadow-sm hover:bg-brand-hover"><Snowflake className="size-4" aria-hidden="true" />Open the permit submission page</Link>
      <p className="mt-2 text-xs text-stone-500">Receive books, the monthly submissions and the final report.</p>
      {q.data.flowchart ? <p className="mt-2 text-sm"><button type="button" onClick={() => open(q.data!.flowchart!.storage_path)} className="inline-flex items-center gap-1.5 text-brand hover:underline"><FileText className="size-4" aria-hidden="true" />The State's instructions (flowchart)</button></p> : null}
      {seasons.length ? (
        <div className="mt-4 space-y-3">
          {seasons.map((label) => (
            <div key={label}>
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label} Season</p>
              <div className="mt-1 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {SEASON_FOLDERS.map((f) => {
                  const mine = q.data!.files.filter((x) => x.season_label === label && f.kinds.includes(x.kind as VendorLinkKind))
                  return (
                    <div key={f.label} className="rounded-xl border border-stone-200 p-3">
                      <p className="flex items-center gap-1.5 text-sm font-medium text-stone-800"><Folder className="size-4 text-stone-400" aria-hidden="true" />{f.label} <span className="text-xs font-normal text-stone-500">({mine.length})</span></p>
                      {mine.length ? <ul className="mt-1 space-y-0.5 text-xs">{mine.map((x) => <li key={x.id}><button type="button" onClick={() => open(x.storage_path)} className="text-left text-brand hover:underline">{x.file_name ?? x.label}</button></li>)}</ul> : <p className="mt-1 text-xs text-stone-400">Empty</p>}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
