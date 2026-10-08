import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { ChevronDown, ChevronRight, ExternalLink, Megaphone, MessageCircleQuestion, Paperclip, X } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { getEmailBody, listSenderEmails, openAttachment, resolveEmailSender, reviewSenderEmails, type SenderEmail } from '@/services/mail'
import { ROUTES } from '@/lib/constants'
import { cn, errorMessage } from '@/lib/utils'
import type { NewVendorPrefill } from '@/components/vendors/VendorPicker'
import { VendorPicker } from '@/components/vendors/VendorPicker'
import { Button, Spinner } from '@/components/ui'

const open = (e: SenderEmail) => !e.vendor_id && !e.disposition

/**
 * Every email from one sender, to read before deciding (Dana, Oct 8). Tick some and file them to a vendor
 * or mark them Marketing or Other; tick all and it is the answer for the sender, future mail included.
 */
export function SenderEmailsPanel({ senderId, senderLabel, prefill, canEdit = true, onClose, onChanged }: {
  senderId: string
  canEdit?: boolean
  senderLabel: string
  prefill?: NewVendorPrefill
  onClose: () => void
  onChanged: () => void | Promise<void>
}) {
  const q = useSupabaseQuery(() => listSenderEmails(senderId), [senderId])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [reading, setReading] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [filing, setFiling] = useState(false)
  const all = q.data ?? []
  const left = all.filter(open)
  const allPicked = left.length > 0 && left.every((e) => picked.has(e.id))

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && !busy) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, busy])

  function toggle(id: string) {
    setPicked((p) => {
      const next = new Set(p)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function act(action: 'vendor' | 'marketing' | 'other', vendor?: { id: string; name: string }) {
    const ids = [...picked]
    if (!ids.length) return
    setBusy(true)
    try {
      if (allPicked) {
        // Every open email: the answer for the sender, their future mail included.
        const kind = action === 'vendor' ? 'vendor' : action === 'marketing' ? 'marketing' : 'not_vendor'
        await resolveEmailSender(senderId, kind, vendor?.id)
        toast.success(action === 'vendor' ? `All of ${senderLabel}'s mail goes to ${vendor!.name}` : action === 'marketing' ? 'Marketing: all their mail goes to Offers & catalogs' : 'Other: all their mail stays in Needs attention for you')
        await onChanged()
        onClose()
        return
      }
      const n = await reviewSenderEmails(senderId, ids, action, vendor?.id)
      toast.success(`${n} email${n === 1 ? '' : 's'} ${action === 'vendor' ? `filed to ${vendor!.name}` : action === 'marketing' ? 'moved to Offers & catalogs' : 'kept in Needs attention for you'}`)
      setPicked(new Set())
      setFiling(false)
      await q.refetch()
      await onChanged()
      if (!(await listSenderEmails(senderId)).some(open)) onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-stone-900/30" role="dialog" aria-modal="true" aria-label={`Emails from ${senderLabel}`} onClick={(ev) => { if (ev.target === ev.currentTarget && !busy) onClose() }}>
      <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-stone-200 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-stone-900">Emails from {senderLabel}</h2>
            <p className="text-xs text-stone-500">{q.isLoading ? 'Loading…' : `${left.length} of ${all.length} left to decide`}</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100"><X className="size-5" aria-hidden="true" /></button>
        </div>

        {left.length && canEdit ? (
          <label className="flex items-center gap-2 border-b border-stone-100 px-4 py-2 text-sm text-stone-700">
            <input type="checkbox" className="size-4 accent-brand" checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(left.map((e) => e.id)))} />
            Select all {left.length}{allPicked ? <span className="text-xs text-stone-500">(the answer covers their future mail too)</span> : null}
          </label>
        ) : null}

        <div className="flex-1 overflow-y-auto">
          {q.error ? <p className="m-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">Could not load the emails: {q.error}</p> : null}
          {q.isLoading ? <div className="flex justify-center py-12"><Spinner label="Loading emails…" className="text-brand" /></div> : (
            <ul className="divide-y divide-stone-100">
              {all.map((e) => {
                const done = !open(e)
                return (
                  <li key={e.id} className={cn('px-4 py-2.5', done && 'bg-stone-50')}>
                    <div className="flex items-start gap-3">
                      {canEdit ? <input type="checkbox" className="mt-1 size-4 accent-brand" disabled={done || busy} checked={picked.has(e.id)} onChange={() => toggle(e.id)} aria-label={`Select ${e.subject ?? 'email'}`} /> : null}
                      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setReading(reading === e.id ? null : e.id)} aria-expanded={reading === e.id}>
                        <p className="flex items-center gap-1 text-sm font-medium text-stone-900">
                          {reading === e.id ? <ChevronDown className="size-4 shrink-0 text-stone-400" aria-hidden="true" /> : <ChevronRight className="size-4 shrink-0 text-stone-400" aria-hidden="true" />}
                          <span className="truncate">{e.subject || '(no subject)'}</span>
                          {e.has_attachments ? <Paperclip className="size-3.5 shrink-0 text-stone-400" aria-label="Has attachments" /> : null}
                        </p>
                        <p className="truncate text-xs text-stone-500">{new Date(e.received_at).toLocaleDateString()} · {e.from_name || e.from_email}{e.snippet ? ` · ${e.snippet}` : ''}</p>
                      </button>
                      {done ? <span className="shrink-0 text-xs text-stone-500">{e.vendors ? e.vendors.name : e.disposition === 'marketing' ? 'Marketing' : 'Other'}</span> : null}
                    </div>
                    {reading === e.id ? <EmailBody emailId={e.id} threadId={e.thread_id} /> : null}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {canEdit ? <div className="border-t border-stone-200 px-4 py-3">
          {picked.size === 0 ? <p className="text-sm text-stone-500">Tick emails to file them, or Select all to answer for the whole sender.</p> : filing ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <VendorPicker autoFocus className="sm:w-72" prefill={prefill} placeholder="Which vendor?" onPick={(v) => act('vendor', v)} />
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setFiling(false)}>Cancel</Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-stone-700">{picked.size} selected:</span>
              <Button size="sm" disabled={busy} onClick={() => setFiling(true)}>File to a vendor</Button>
              <Button size="sm" variant="secondary" loading={busy} onClick={() => void act('marketing')} leftIcon={<Megaphone className="size-4" aria-hidden="true" />}>Marketing</Button>
              <Button size="sm" variant="ghost" loading={busy} onClick={() => void act('other')} leftIcon={<MessageCircleQuestion className="size-4" aria-hidden="true" />}>Other – not a vendor</Button>
            </div>
          )}
        </div> : null}
      </div>
    </div>,
    document.body,
  )
}

function EmailBody({ emailId, threadId }: { emailId: string; threadId: string }) {
  const q = useSupabaseQuery(() => getEmailBody(emailId), [emailId])
  return (
    <div className="ml-7 mt-2 rounded-lg border border-stone-200 bg-white p-3 text-sm">
      {q.isLoading ? <p className="text-stone-500">Loading…</p> : (
        <>
          <p className="max-h-80 overflow-y-auto whitespace-pre-line text-stone-800">{q.data?.body_text?.trim() || '(no text)'}</p>
          {q.data?.attachments.length ? (
            <ul className="mt-2 flex flex-wrap gap-2">
              {q.data.attachments.map((a) => (
                <li key={a.id}><button type="button" onClick={() => void openAttachment(a.id)} className="inline-flex items-center gap-1 rounded-md bg-stone-100 px-2 py-1 text-xs text-stone-700 hover:bg-stone-200"><Paperclip className="size-3.5" aria-hidden="true" />{a.file_name}</button></li>
              ))}
            </ul>
          ) : null}
          <Link to={`${ROUTES.mail}/${threadId}`} target="_blank" className="mt-2 inline-flex items-center gap-1 text-xs text-brand hover:underline">Open the whole conversation <ExternalLink className="size-3.5" aria-hidden="true" /></Link>
        </>
      )}
    </div>
  )
}
