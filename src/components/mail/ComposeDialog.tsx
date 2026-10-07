import { useEffect, useRef, useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { Paperclip, Send, X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { sendEmail, type SendEmailInput } from '@/services/mail'
import { listVendorLinks } from '@/services/lines'
import { errorMessage } from '@/lib/utils'
import { Button, FormField, Input, Textarea } from '@/components/ui'

export interface ComposeDraft {
  to: string[]
  cc?: string[]
  subject: string
  body: string
  thread_id?: string | null
  reply_to_email_id?: string | null
  forward_email_id?: string | null
  vendor_id?: string | null
  /** Shown as a note above the form, e.g. "Forwarding with 2 attachments". */
  note?: string
}

const MAX_BYTES = 20 * 1024 * 1024

const splitAddresses = (s: string) => s.split(/[,;\s]+/).map((a) => a.trim()).filter(Boolean)

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

/**
 * Write an email from orders@ as yourself: new, reply, reply all, forward or follow-up. Your signature
 * is added when it sends; the conversation is filed to the vendor and waits on them until they answer.
 */
export function ComposeDialog({ draft, suggestions = [], onClose, onSent }: { draft: ComposeDraft; suggestions?: { email: string; label: string }[]; onClose: () => void; onSent?: (threadId: string) => void }) {
  const { profile } = useAuth()
  const [to, setTo] = useState(draft.to.join(', '))
  const [cc, setCc] = useState((draft.cc ?? []).join(', '))
  const [subject, setSubject] = useState(draft.subject)
  const [body, setBody] = useState(draft.body)
  const [files, setFiles] = useState<File[]>([])
  const [linkIds, setLinkIds] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const links = useSupabaseQuery(async () => (draft.vendor_id ? (await listVendorLinks(draft.vendor_id)).filter((l) => l.storage_path) : []), [draft.vendor_id])

  useEffect(() => {
    // Replies start with the cursor above the quoted mail.
    bodyRef.current?.focus()
    bodyRef.current?.setSelectionRange(0, 0)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !sending) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, sending])

  function addTo(email: string) {
    const list = splitAddresses(to)
    if (!list.map((a) => a.toLowerCase()).includes(email.toLowerCase())) setTo([...list, email].join(', '))
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const total = files.reduce((n, f) => n + f.size, 0)
    if (total > MAX_BYTES) return toast.error('Attachments add up to more than 20 MB. Leave some out or send them separately.')
    setSending(true)
    try {
      const input: SendEmailInput = {
        thread_id: draft.thread_id ?? null,
        reply_to_email_id: draft.reply_to_email_id ?? null,
        forward_email_id: draft.forward_email_id ?? null,
        vendor_id: draft.vendor_id ?? null,
        to: splitAddresses(to),
        cc: splitAddresses(cc),
        subject,
        body,
        attachments: await Promise.all(files.map(async (f) => ({ name: f.name, mime: f.type || 'application/octet-stream', base64: await readBase64(f) }))),
        vendor_link_ids: linkIds,
      }
      const res = await sendEmail(input)
      toast.success('Sent')
      onSent?.(res.thread_id)
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSending(false)
    }
  }

  const unused = suggestions.filter((s) => !splitAddresses(to).map((a) => a.toLowerCase()).includes(s.email.toLowerCase()))

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Write an email">
      <form onSubmit={submit} className="flex max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-h-[90vh] sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
          <h2 className="text-base font-semibold text-stone-900">{draft.forward_email_id ? 'Forward' : draft.thread_id ? 'Reply' : 'New email'}</h2>
          <button type="button" onClick={onClose} disabled={sending} aria-label="Close" className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100"><X className="size-5" aria-hidden="true" /></button>
        </div>
        <div className="space-y-3 overflow-y-auto px-4 py-3">
          {draft.note ? <p className="rounded-lg bg-stone-50 px-3 py-2 text-xs text-stone-600">{draft.note}</p> : null}
          <FormField label="To" htmlFor="compose-to">
            <Input id="compose-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@vendor.com" autoComplete="off" required />
          </FormField>
          {unused.length ? (
            <div className="-mt-1 flex flex-wrap gap-1">
              {unused.map((s) => <button key={s.email} type="button" onClick={() => addTo(s.email)} className="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-700 hover:bg-stone-200">+ {s.label}</button>)}
            </div>
          ) : null}
          <FormField label="Cc" htmlFor="compose-cc"><Input id="compose-cc" value={cc} onChange={(e) => setCc(e.target.value)} autoComplete="off" /></FormField>
          <FormField label="Subject" htmlFor="compose-subject"><Input id="compose-subject" value={subject} onChange={(e) => setSubject(e.target.value)} required /></FormField>
          <FormField label="Message" htmlFor="compose-body" hint={profile?.email_signature ? 'Your signature is added when it sends.' : 'No signature on file yet; Dana adds them in Settings > Mail.'}>
            <Textarea id="compose-body" ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} rows={12} />
          </FormField>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => fileInput.current?.click()} leftIcon={<Paperclip className="size-4" aria-hidden="true" />}>Attach from computer</Button>
              <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => { setFiles((f) => [...f, ...Array.from(e.target.files ?? [])]); e.target.value = '' }} />
            </div>
            {files.length ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-lg bg-stone-100 px-2 py-1 text-xs text-stone-700">
                    {f.name}
                    <button type="button" onClick={() => setFiles((all) => all.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`} className="text-stone-400 hover:text-red-600"><X className="size-3.5" aria-hidden="true" /></button>
                  </li>
                ))}
              </ul>
            ) : null}
            {(links.data ?? []).length ? (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-medium text-stone-600">Attach from the vendor's files ({links.data!.length})</summary>
                <ul className="mt-1 space-y-1">
                  {links.data!.map((l) => (
                    <li key={l.id}>
                      <label className="flex items-center gap-2 text-sm text-stone-700">
                        <input type="checkbox" checked={linkIds.includes(l.id)} onChange={(e) => setLinkIds((ids) => (e.target.checked ? [...ids, l.id] : ids.filter((x) => x !== l.id)))} className="size-4 rounded border-stone-300" />
                        {l.label}{l.file_name && l.file_name !== l.label ? <span className="text-xs text-stone-400">{l.file_name}</span> : null}
                      </label>
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-stone-200 px-4 py-3">
          <p className="text-xs text-stone-500">Sends from orders@ as {profile?.full_name ?? 'you'}.</p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={sending}>Cancel</Button>
            <Button type="submit" loading={sending} leftIcon={<Send className="size-4" aria-hidden="true" />}>Send</Button>
          </div>
        </div>
      </form>
    </div>
  )
}
