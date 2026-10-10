import { useState } from 'react'
import toast from 'react-hot-toast'
import { AlarmClock } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { clearSnooze, snooze, type SnoozeKind } from '@/services/snooze'
import { isFuture, snoozeChoicesNow, snoozeText } from '@/lib/snooze'
import { errorMessage } from '@/lib/utils'
import { Button, Dropdown } from '@/components/ui'

/**
 * Snooze (Dana, Oct 9): hide a conversation or review item from your own lists for hours or days; it comes
 * back on its own (a vendor reply brings a conversation back at once). Several ids snooze together.
 */
export function SnoozeButton({ kind, ids, until, onDone, compact = false }: { kind: SnoozeKind; ids: string[]; until?: string | null; onDone: () => void | Promise<unknown>; compact?: boolean }) {
  const { organization, profile } = useAuth()
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  if (!organization || !profile || !ids.length) return null

  async function apply(when: Date | null, close: () => void) {
    close()
    setBusy(true)
    try {
      if (when) {
        await snooze(organization!.id, profile!.id, kind, ids, when)
        toast.success(`Snoozed until ${snoozeText(when)}`)
      } else {
        await Promise.all(ids.map((id) => clearSnooze(profile!.id, kind, id)))
        toast.success('Back in your list')
      }
      await onDone()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dropdown label="Snooze" align={compact ? 'left' : 'right'} trigger={(t) => compact ? (
      <button type="button" onClick={t.toggle} aria-expanded={t['aria-expanded']} aria-controls={t['aria-controls']} aria-haspopup title={until ? `Snoozed until ${snoozeText(until)}` : 'Snooze'} aria-label="Snooze"
        className={`rounded-md p-1 hover:bg-amber-50 hover:text-amber-700 ${until ? 'text-amber-600' : 'text-stone-400'}`} disabled={busy}>
        <AlarmClock className="size-4" aria-hidden="true" />
      </button>
    ) : (
      <Button size="sm" variant="ghost" loading={busy} onClick={t.toggle} aria-expanded={t['aria-expanded']} aria-controls={t['aria-controls']} aria-haspopup leftIcon={<AlarmClock className="size-4" aria-hidden="true" />}>
        {until ? `Snoozed until ${snoozeText(until)}` : ids.length > 1 ? `Snooze ${ids.length}` : 'Snooze'}
      </Button>
    )}>
      {(close) => (
        <div className="w-64 text-sm">
          {snoozeChoicesNow().map((c) => (
            <button key={c.label} type="button" onClick={() => void apply(c.until, close)} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-stone-100">
              <span>{c.label}</span><span className="text-xs text-stone-500">{snoozeText(c.until)}</span>
            </button>
          ))}
          <div className="mt-1 border-t border-stone-100 px-3 py-2">
            <label className="block text-xs font-medium text-stone-500">Pick a date and time
              <input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-stone-300 px-2 text-sm" />
            </label>
            <Button size="sm" className="mt-2 w-full" disabled={!isFuture(custom)} onClick={() => void apply(new Date(custom), close)}>Snooze until then</Button>
          </div>
          {until ? <button type="button" onClick={() => void apply(null, close)} className="w-full rounded-lg px-3 py-2 text-left font-medium text-brand hover:bg-stone-100">Unsnooze now</button> : null}
        </div>
      )}
    </Dropdown>
  )
}
