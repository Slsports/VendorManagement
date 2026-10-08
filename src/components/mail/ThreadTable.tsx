import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Check, Paperclip } from 'lucide-react'
import { setEmailThreadStatus } from '@/services/mail'
import { errorMessage } from '@/lib/utils'
import { Button } from '@/components/ui'
import { useTableSort } from '@/hooks/useTableSort'
import { threadState } from '@/lib/mail'
import { ROUTES } from '@/lib/constants'
import type { ThreadRow } from '@/services/mail'
import { SortHeader } from '@/components/shared/SortHeader'
import { ThreadStatusBadge } from './ThreadStatusBadge'

const STATE_ORDER = { needs: 0, no_answer: 1, waiting: 2, handled: 3 }

/**
 * Mail threads as a sortable table: who, what, vendor, owner, where it stands, when. With `onChanged`, each
 * row has a ✓ to mark it handled without opening it, and checkboxes mark several at once (Dana, Oct 8).
 */
export function ThreadTable({ rows, showVendor = true, sortParam, onChanged }: { rows: ThreadRow[]; showVendor?: boolean; sortParam?: string; onChanged?: () => void | Promise<unknown> }) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const openRows = rows.filter((t) => t.status !== 'handled')
  const pickedRows = rows.filter((t) => picked.has(t.id) && t.status !== 'handled')

  async function markHandled(list: ThreadRow[]) {
    if (!list.length) return
    setBusy(true)
    const before = list.map((t) => ({ id: t.id, status: t.status }))
    try {
      await Promise.all(list.map((t) => setEmailThreadStatus(t.id, 'handled')))
      setPicked(new Set())
      await onChanged?.()
      toast((tt) => (
        <span className="flex items-center gap-3 text-sm">
          {list.length === 1 ? 'Marked handled' : `${list.length} marked handled`}
          <button type="button" className="font-semibold text-brand hover:underline" onClick={() => {
            toast.dismiss(tt.id)
            void Promise.all(before.map((b) => setEmailThreadStatus(b.id, b.status))).then(() => onChanged?.()).catch((err) => toast.error(errorMessage(err)))
          }}>Undo</button>
        </span>
      ), { duration: 6000 })
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }
  const toggle1 = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const { sorted, sort, toggle } = useTableSort(rows, {
    from: (t) => t.last?.from_name || t.last?.from_email,
    subject: (t) => t.subject,
    vendor: (t) => t.vendor?.name,
    owner: (t) => t.owner?.full_name,
    status: (t) => STATE_ORDER[threadState(t)],
    when: (t) => t.last_message_at,
  }, { param: sortParam, descFirst: ['when'] })

  return (
    <>
    {onChanged && pickedRows.length ? (
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm">
        <span className="font-medium text-stone-700">{pickedRows.length} selected</span>
        <Button size="sm" loading={busy} onClick={() => void markHandled(pickedRows)} leftIcon={<Check className="size-4" aria-hidden="true" />}>Mark handled</Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPicked(new Set())}>Clear</Button>
      </div>
    ) : null}
    <div className="overflow-x-auto rounded-2xl border border-stone-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
          <tr>
            {onChanged ? (
              <th className="w-16 px-3 py-2">
                <input type="checkbox" aria-label="Select all" disabled={!openRows.length} checked={!!openRows.length && openRows.every((t) => picked.has(t.id))}
                  onChange={(e) => setPicked(e.target.checked ? new Set(openRows.map((t) => t.id)) : new Set())} className="size-4 rounded border-stone-300" />
              </th>
            ) : null}
            <SortHeader label="From" sortKey="from" sort={sort} onSort={toggle} className="px-3 py-2" />
            <SortHeader label="Subject" sortKey="subject" sort={sort} onSort={toggle} className="px-3 py-2" />
            {showVendor ? <SortHeader label="Vendor" sortKey="vendor" sort={sort} onSort={toggle} className="hidden px-3 py-2 md:table-cell" /> : null}
            <SortHeader label="Owner" sortKey="owner" sort={sort} onSort={toggle} className="hidden px-3 py-2 md:table-cell" />
            <SortHeader label="Status" sortKey="status" sort={sort} onSort={toggle} className="px-3 py-2" />
            <SortHeader label="Last" sortKey="when" sort={sort} onSort={toggle} className="px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {sorted.map((t) => (
            <tr key={t.id} className="align-top hover:bg-stone-50">
              {onChanged ? (
                <td className="whitespace-nowrap px-3 py-2">
                  <span className="flex items-center gap-1">
                    <input type="checkbox" aria-label={`Select ${t.subject || 'conversation'}`} disabled={t.status === 'handled'} checked={picked.has(t.id)} onChange={() => toggle1(t.id)} className="size-4 rounded border-stone-300" />
                    {t.status !== 'handled' ? (
                      <button type="button" disabled={busy} onClick={() => void markHandled([t])} title="Mark handled" aria-label={`Mark handled: ${t.subject || 'conversation'}`}
                        className="rounded-md p-1 text-stone-400 hover:bg-emerald-50 hover:text-emerald-700"><Check className="size-4" aria-hidden="true" /></button>
                    ) : <Check className="size-4 text-emerald-600" aria-label="Handled" />}
                  </span>
                </td>
              ) : null}
              <td className="max-w-[12rem] px-3 py-2">
                <span className="block truncate font-medium text-stone-900">{t.last?.direction === 'out' ? 'We wrote last' : t.last?.from_name || t.last?.from_email || '—'}</span>
                {t.message_count > 1 ? <span className="text-xs text-stone-500">{t.message_count} messages</span> : null}
              </td>
              <td className="max-w-md px-3 py-2">
                <Link to={`${ROUTES.mail}/${t.id}`} className="font-medium text-stone-900 hover:text-brand">{t.subject || '(no subject)'}</Link>
                {t.last?.has_attachments ? <Paperclip className="ml-1 inline size-3.5 text-stone-400" aria-label="Has attachments" /> : null}
                {t.last?.snippet ? <span className="block truncate text-xs text-stone-500">{t.last.snippet}</span> : null}
              </td>
              {showVendor ? (
                <td className="hidden px-3 py-2 md:table-cell">
                  {t.vendor ? <Link to={`${ROUTES.vendors}/${t.vendor.id}`} className="text-stone-700 hover:text-brand">{t.vendor.name}</Link> : <span className="text-xs text-stone-400">Not filed</span>}
                </td>
              ) : null}
              <td className="hidden whitespace-nowrap px-3 py-2 text-stone-600 md:table-cell">{t.owner?.full_name ?? <span className="text-xs text-stone-400">Nobody</span>}</td>
              <td className="whitespace-nowrap px-3 py-2"><ThreadStatusBadge thread={t} /></td>
              <td className="whitespace-nowrap px-3 py-2 text-stone-600">{t.last_message_at ? new Date(t.last_message_at).toLocaleDateString() : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  )
}
