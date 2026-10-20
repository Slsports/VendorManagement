import { useEffect, useRef, useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { FileText, Inbox, Paperclip, Send, X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listMailboxes, saveDraft, sendEmail, type SendEmailInput } from '@/services/mail'
import { listAddressBook } from '@/services/contacts'
import { listVendorLinks } from '@/services/lines'
import { errorMessage } from '@/lib/utils'
import { fillSignature, LOGO_URL } from '@/lib/signature'
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
  /** A new email from my own mailbox instead of orders@ (Dana, Oct 11). Replies always go from their conversation's mailbox. */
  mailbox_id?: string | null
  /** Shown as a note above the form, e.g. "Forwarding with 2 attachments". */
  note?: string
  /** Opened from Mail › Drafts (Dana, Oct 12): Save draft updates it, Send removes it. */
  draft_id?: string | null
  /** Files already on file to attach (Dana, Oct 16: the policy for a proof-of-insurance send). */
  vendor_link_ids?: string[]
  /** The signature saved with a draft; otherwise the person's usual one. */
  signature?: string | null
  /** A routing letter email prepared from Freight › Routing letter: the letter goes with it. */
  routing_send_id?: string | null
  /** A contact confirmation email prepared from Vendors › Contact confirmations. */
  confirmation_id?: string | null
  /** A shipping email (Dana, Oct 20): the current routing letter goes with it. */
  attach_routing_letter?: boolean
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
 * Write an email from orders@ as yourself: new, reply, reply all, forward or follow-up. The signature shows under the
 * message with the logo and can be changed for this email (Dana, Oct 13); the conversation is filed to the vendor and
 * waits on them until they answer. Vendor business from your own inbox asks once whether to send it from orders@.
 */
export function ComposeDialog({ draft, suggestions = [], onClose, onSent }: { draft: ComposeDraft; suggestions?: { email: string; label: string }[]; onClose: () => void; onSent?: (threadId: string) => void }) {
  const { profile, organization } = useAuth()
  const [to, setTo] = useState(draft.to.join(', '))
  const [cc, setCc] = useState((draft.cc ?? []).join(', '))
  const [subject, setSubject] = useState(draft.subject)
  const [body, setBody] = useState(draft.body)
  const [files, setFiles] = useState<File[]>([])
  const [linkIds, setLinkIds] = useState<string[]>(draft.vendor_link_ids ?? [])
  const [sending, setSending] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draftId, setDraftId] = useState<string | null>(draft.draft_id ?? null)
  const [signature, setSignature] = useState(() => draft.signature ?? fillSignature(organization?.signature_template ?? null, {
    name: profile?.signature_name || profile?.full_name || null, title: profile?.job_title ?? null, direct: profile?.direct_phone ?? null, own: profile?.email_signature ?? null,
  }))
  const [choice, setChoice] = useState<{ reason: string; input: SendEmailInput } | null>(null)
  const [attachLetter, setAttachLetter] = useState(!!draft.attach_routing_letter)
  const fileInput = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const book = useSupabaseQuery(async () => (organization ? listAddressBook(organization.id) : []), [organization?.id])
  const [who, setWho] = useState('')
  // From: orders@ or my own mailbox, for a new email
  const [fromBox, setFromBox] = useState<string>(draft.mailbox_id ?? '')
  const boxes = useSupabaseQuery(async () => (organization && !draft.thread_id ? listMailboxes(organization.id) : []), [organization?.id, draft.thread_id])
  const myBox = (boxes.data ?? []).find((b) => b.kind === 'personal' && b.owner_id === profile?.id)
  const links = useSupabaseQuery(async () => (draft.vendor_id ? (await listVendorLinks(draft.vendor_id)).filter((l) => l.storage_path) : []), [draft.vendor_id])

  useEffect(() => {
    // Replies start with the cursor above the quoted mail.
    bodyRef.current?.focus()
    bodyRef.current?.setSelectionRange(0, 0)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !sending && !choice) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, sending, choice])

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
        mailbox_id: draft.thread_id ? null : fromBox || null,
        draft_id: draftId,
        signature,
        routing_send_id: draft.routing_send_id ?? null,
        confirmation_id: draft.confirmation_id ?? null,
        attach_routing_letter: !draft.routing_send_id && attachLetter,
      }
      await send(input)
    } catch (err) {
      toast.error(errorMessage(err))
      setSending(false)
    }
  }

  async function send(input: SendEmailInput) {
    setSending(true)
    try {
      const res = await sendEmail(input)
      if (res.needs_choice) {
        setChoice({ reason: res.reason, input })
        return
      }
      setChoice(null)
      toast.success(input.vendor_check === 'orders' ? 'Sent from orders@' : 'Sent')
      onSent?.(res.thread_id)
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSending(false)
    }
  }

  /** Save draft (Dana, Oct 12): keep it in Mail › Drafts to finish or send later. Attachments picked from the computer are not kept. */
  async function keepDraft() {
    if (!organization || !profile) return
    setSaving(true)
    try {
      const id = await saveDraft(organization.id, profile.id, {
        id: draftId, to: splitAddresses(to), cc: splitAddresses(cc), subject, body,
        thread_id: draft.thread_id ?? null, reply_to_email_id: draft.reply_to_email_id ?? null, forward_email_id: draft.forward_email_id ?? null,
        vendor_id: draft.vendor_id ?? null, mailbox_id: draft.thread_id ? null : fromBox || null, signature,
      })
      setDraftId(id)
      toast.success(files.length ? 'Saved in Drafts (attach the files again when you send)' : 'Saved in Drafts')
      onClose()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  const fromAddress = draft.thread_id ? 'this conversation\'s mailbox' : fromBox && myBox ? myBox.address : 'orders@'
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
          {myBox ? (
            <FormField label="From" htmlFor="compose-from">
              <select id="compose-from" value={fromBox} onChange={(e) => setFromBox(e.target.value)} className="h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-base shadow-sm sm:text-sm">
                <option value="">Orders (orders@)</option>
                <option value={myBox.id}>Me ({myBox.address})</option>
              </select>
            </FormField>
          ) : null}
          <FormField label="To" htmlFor="compose-to">
            <Input id="compose-to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@vendor.com" autoComplete="off" required />
          </FormField>
          {(book.data ?? []).length ? (
            <div className="-mt-1">
              <Input list="compose-book" value={who} aria-label="Add someone"
                placeholder="Add someone: type a name or Worldwide"
                className="h-9"
                onChange={(e) => {
                  const v = e.target.value
                  const hit = (book.data ?? []).find((b) => bookLabel(b) === v)
                  if (hit) { addTo(hit.email); setWho('') } else setWho(v)
                }} />
              <datalist id="compose-book">{(book.data ?? []).map((b) => <option key={`${b.email}-${b.name}`} value={bookLabel(b)} />)}</datalist>
            </div>
          ) : null}
          {unused.length ? (
            <div className="-mt-1 flex flex-wrap gap-1">
              {unused.map((s) => <button key={s.email} type="button" onClick={() => addTo(s.email)} className="rounded-full bg-stone-100 px-2.5 py-1 text-xs text-stone-700 hover:bg-stone-200">+ {s.label}</button>)}
            </div>
          ) : null}
          <FormField label="Cc" htmlFor="compose-cc"><Input id="compose-cc" value={cc} onChange={(e) => setCc(e.target.value)} autoComplete="off" /></FormField>
          <FormField label="Subject" htmlFor="compose-subject"><Input id="compose-subject" value={subject} onChange={(e) => setSubject(e.target.value)} required /></FormField>
          <FormField label="Message" htmlFor="compose-body">
            <Textarea id="compose-body" ref={bodyRef} value={body} onChange={(e) => setBody(e.target.value)} rows={12} />
          </FormField>
          <FormField label="Signature" htmlFor="compose-signature" hint="Goes under your message, with the logo. Changes here are for this email only.">
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-2">
              {signature.trim() ? <img src={LOGO_URL.replace(/^https:\/\/[^/]+/, '')} alt="Shaver Lake Sports" width={240} height={31} className="mb-1.5 h-auto max-w-[240px]" /> : null}
              <Textarea id="compose-signature" value={signature} onChange={(e) => setSignature(e.target.value)} rows={Math.min(8, Math.max(3, signature.split('\n').length))} className="bg-white text-sm" />
            </div>
          </FormField>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => fileInput.current?.click()} leftIcon={<Paperclip className="size-4" aria-hidden="true" />}>Attach from computer</Button>
              {draft.routing_send_id ? <span className="text-xs font-medium text-stone-600">The routing letter is attached when it sends.</span>
                : <label className="flex items-center gap-1.5 text-sm text-stone-700"><input type="checkbox" checked={attachLetter} onChange={(e) => setAttachLetter(e.target.checked)} className="size-4 accent-brand" />Attach our routing letter</label>}
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
          <p className="text-xs text-stone-500">Sends from {fromAddress} as {profile?.full_name ?? 'you'}.</p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={sending || saving}>Cancel</Button>
            <Button type="button" variant="secondary" onClick={() => void keepDraft()} loading={saving} disabled={sending} leftIcon={<FileText className="size-4" aria-hidden="true" />}>Save draft</Button>
            <Button type="submit" loading={sending} leftIcon={<Send className="size-4" aria-hidden="true" />}>Send</Button>
          </div>
        </div>
      </form>
      {choice ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-stone-900/40 sm:items-center sm:p-4" role="alertdialog" aria-modal="true" aria-label="Send from orders@?">
          <div className="w-full max-w-md overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
            <div className="flex items-start gap-3 px-4 py-4">
              <Inbox className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden="true" />
              <div>
                <h2 className="text-base font-semibold text-stone-900">Send this from orders@?</h2>
                <p className="mt-1 text-sm text-stone-600">{choice.reason}</p>
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t border-stone-200 px-4 py-3 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => setChoice(null)} disabled={sending}>Go back</Button>
              <Button type="button" variant="secondary" onClick={() => void send({ ...choice.input, vendor_check: 'skip' })} disabled={sending}>Send from my inbox anyway</Button>
              <Button type="button" loading={sending} onClick={() => void send({ ...choice.input, vendor_check: 'orders' })}>Send from orders@ instead</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

const bookLabel = (b: { name: string; where: string; email: string }) => `${b.name} (${b.where}) <${b.email}>`
