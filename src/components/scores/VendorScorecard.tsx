import { useState } from 'react'
import toast from 'react-hot-toast'
import { Star } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { getScorecard, rateVendor } from '@/services/scores'
import { SCORE_DIMENSIONS, SCORE_WORDS, evidence, scoreTone } from '@/lib/scores'
import { errorMessage } from '@/lib/utils'
import { standingWhy } from '@/lib/vendors'
import type { ScoreDimension, VendorScorecard as Card } from '@/types'
import { Button, Input, Select, Spinner } from '@/components/ui'

export interface VendorScorecardProps {
  organizationId: string
  vendorId: string
  userId: string | null
  canEdit: boolean
}

function autoScore(c: Card, key: ScoreDimension): number | null {
  return key === 'fulfilment' ? c.auto_fulfilment : key === 'accuracy' ? c.auto_accuracy : key === 'shipping' ? c.auto_shipping : key === 'resolution' ? c.auto_resolution : null
}
function ratedScore(c: Card, key: ScoreDimension): number | null {
  return c[`rated_${key}` as const]
}
function ratedNote(c: Card, key: ScoreDimension): string | null {
  return c[`note_${key}` as const]
}

const TONE: Record<ReturnType<typeof scoreTone>, string> = { good: 'text-emerald-700', mid: 'text-amber-700', bad: 'text-red-700', none: 'text-stone-400' }

function Stars({ score }: { score: number | null }) {
  return (
    <span className={`inline-flex items-center gap-0.5 ${TONE[scoreTone(score)]}`} aria-label={score === null ? 'No score' : `${score} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => <Star key={n} className="size-3.5" fill={score !== null && n <= score ? 'currentColor' : 'none'} aria-hidden="true" />)}
    </span>
  )
}

export function VendorScorecard({ organizationId, vendorId, userId, canEdit }: VendorScorecardProps) {
  const q = useSupabaseQuery(() => getScorecard(organizationId, vendorId), [organizationId, vendorId])
  const [editing, setEditing] = useState<ScoreDimension | null>(null)
  const [score, setScore] = useState('')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const c = q.data

  async function save() {
    if (!editing || !score) return
    setSaving(true)
    try {
      await rateVendor({ organization_id: organizationId, vendor_id: vendorId, dimension: editing, score: Number(score), note: note.trim() || null, rated_by: userId })
      toast.success('Rating saved')
      setEditing(null)
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Scorecard</h2>
        {c ? <span className="inline-flex items-center gap-2 text-sm"><Stars score={c.overall !== null ? Math.round(c.overall) : null} /><span className={`font-semibold ${TONE[scoreTone(c.overall)]}`}>{c.overall !== null ? `${c.overall} / 5` : 'Not scored yet'}</span></span> : null}
      </div>
      {c && c.standing !== 'ok' ? (
        <p className={`mt-2 rounded-lg px-3 py-2 text-sm ${c.standing === 'do_not_order' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-900'}`}>
          <span className="font-semibold">{c.standing === 'do_not_order' ? 'Do not order.' : 'Last resort.'}</span>{c.standing_tags.length ? ` Why: ${standingWhy(c.standing_tags)}.` : ''}{c.standing_reason ? ` ${c.standing_reason}` : ''}
        </p>
      ) : null}
      {q.isLoading ? <div className="flex justify-center py-6"><Spinner label="Scoring…" className="text-brand" /></div> : q.error ? <p className="mt-2 text-sm text-red-700">{q.error}</p> : !c ? null : (
        <ul className="mt-3 divide-y divide-stone-100">
          {SCORE_DIMENSIONS.map((d) => {
            const rated = ratedScore(c, d.key)
            const auto = autoScore(c, d.key)
            const final = rated ?? auto
            return (
              <li key={d.key} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-stone-900">{d.label}</p>
                    <p className="text-xs text-stone-600">{evidence(c, d.key)}</p>
                    {rated !== null ? <p className="text-xs text-stone-600">Rated {SCORE_WORDS[rated as 1 | 2 | 3 | 4 | 5].toLowerCase()} by staff{ratedNote(c, d.key) ? `: ${ratedNote(c, d.key)}` : ''}{auto !== null && auto !== rated ? ` (history says ${auto})` : ''}</p> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Stars score={final} />
                    {canEdit && editing !== d.key ? <Button size="sm" variant="ghost" onClick={() => { setEditing(d.key); setScore(rated ? String(rated) : ''); setNote(ratedNote(c, d.key) ?? '') }}>Rate</Button> : null}
                  </div>
                </div>
                {editing === d.key ? (
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Select value={score} onChange={(e) => setScore(e.target.value)} aria-label={`Score for ${d.label}`} className="h-9 sm:w-40">
                      <option value="">Score…</option>
                      {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} · {SCORE_WORDS[n as 1 | 2 | 3 | 4 | 5]}</option>)}
                    </Select>
                    <Input value={note} onChange={(e) => setNote(e.target.value)} aria-label="Why" placeholder="Why (one line)" className="h-9 sm:w-72" />
                    <Button size="sm" loading={saving} disabled={!score} onClick={() => void save()}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-stone-500">Automatic scores come from the order history; a staff rating replaces them. After a full year in VMS the check-in form and vendor emails feed every line.</p>
    </section>
  )
}
