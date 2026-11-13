import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import toast from 'react-hot-toast'
import { FileText, Paperclip, X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listOrdersForPreview, previewFreightEmail } from '@/services/templates'
import { listRoutingLetters, routingLetterPdfBlob } from '@/services/routingLetter'
import { letterContentOf } from '@/lib/routingLetterPdf'
import { htmlEmail } from '@/lib/signature'
import { errorMessage } from '@/lib/utils'
import { Alert, Button, Select, Spinner } from '@/components/ui'

const RECEIPT_PREVIEW = 'https://vms.shaverlakesports.com/r/preview'
const STATUS: Record<string, string> = { open: 'Sent', awaiting_confirmation: 'Placed', confirmed: 'Confirmed', shipped: 'Shipped' }

/**
 * The Freight email as the vendor gets it, for a real order (Dana, Nov 13: "We need a preview button so we can see how the
 * links show up"). Uses the wording on screen, saved or not. Nothing is written or sent; the routing letter's "click here"
 * is not followed from here, so it records nothing.
 */
export function FreightEmailPreview({ subject, body, onClose }: { subject: string; body: string; onClose: () => void }) {
  const { organization } = useAuth()
  const orders = useSupabaseQuery(async () => (organization ? listOrdersForPreview(organization.id) : []), [organization?.id])
  const [orderId, setOrderId] = useState('')
  const chosen = orderId || (orders.data?.find((o) => /^paricon/i.test(o.vendor)) ?? orders.data?.[0])?.id || ''
  const shown = useSupabaseQuery(async () => (chosen ? previewFreightEmail(chosen, subject, body) : null), [chosen, subject, body])
  const [opening, setOpening] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const html = useMemo(() => {
    if (!shown.data) return ''
    const doc = htmlEmail(shown.data.body, null)
    return doc.slice(doc.indexOf('<body>') + 6, doc.lastIndexOf('</body>'))
  }, [shown.data])

  function onEmailClick(e: MouseEvent<HTMLDivElement>) {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault()
    if (a.href === RECEIPT_PREVIEW) {
      toast('In the real email this link records that they received our routing letter. From the preview it records nothing.', { duration: 6000 })
      return
    }
    window.open(a.href, '_blank', 'noopener')
  }

  async function openLetter() {
    if (!organization || !shown.data) return
    setOpening(true)
    const win = window.open('', '_blank')
    try {
      const letter = (await listRoutingLetters(organization.id))[0]
      const content = letterContentOf(letter?.content)
      if (!content) throw new Error('The routing letter was uploaded as a file, so it goes as it is.')
      const form = shown.data.body.match(/https:\/\/vms\.shaverlakesports\.com\/ship\/[0-9a-f-]{36}/)?.[0]
      const swap = (t: string) => (form ? t.replaceAll('https://vms.shaverlakesports.com/ship/new', form).replaceAll('vms.shaverlakesports.com/ship/new', form.replace('https://', '')) : t)
      const blob = await routingLetterPdfBlob({ ...content, intro: swap(content.intro), closing: swap(content.closing), sections: content.sections.map((x) => ({ heading: x.heading, body: swap(x.body) })) })
      const url = URL.createObjectURL(blob)
      if (win) win.location.href = url
      else window.open(url, '_blank')
    } catch (err) {
      win?.close()
      toast.error(errorMessage(err))
    } finally {
      setOpening(false)
    }
  }

  const d = shown.data
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Preview of the freight email">
      <div className="flex max-h-[100dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-h-[92vh] sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
          <h2 className="text-base font-semibold text-stone-900">Preview: what the vendor gets</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100"><X className="size-5" aria-hidden="true" /></button>
        </div>
        <div className="space-y-3 overflow-y-auto px-4 py-3 text-sm">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stone-600">Fill it in for this order</span>
            <Select value={chosen} onChange={(e) => setOrderId(e.target.value)} disabled={!orders.data?.length}>
              {(orders.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.vendor} · PO {o.po ?? '(none)'} · {STATUS[o.status] ?? o.status}</option>)}
            </Select>
          </label>
          {orders.error ? <Alert variant="error">{orders.error}</Alert> : null}
          {shown.error ? <Alert variant="error">{shown.error}</Alert> : null}
          {shown.isLoading && !d ? <div className="flex justify-center py-8"><Spinner label="Filling it in…" className="text-brand" /></div> : null}
          {d ? (
            <>
              <div className="rounded-lg border border-stone-200 text-sm">
                <div className="space-y-0.5 border-b border-stone-200 bg-stone-50 px-3 py-2">
                  <p><span className="text-stone-500">From: </span>orders@shaverlakesports.com</p>
                  <p><span className="text-stone-500">To: </span>{d.to_emails.length ? d.to_emails.join(', ') : <span className="text-amber-700">no email on file for this vendor yet</span>}</p>
                  <p><span className="text-stone-500">Subject: </span><span className="font-semibold text-stone-900">{d.subject}</span></p>
                  {d.has_letter ? (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="inline-flex items-center gap-1 rounded-md border border-stone-300 bg-white px-2 py-0.5 text-xs text-stone-700"><Paperclip className="size-3.5" aria-hidden="true" />Freight routing letter (PDF)</span>
                      <Button size="sm" variant="ghost" loading={opening} onClick={() => void openLetter()} leftIcon={<FileText className="size-4" aria-hidden="true" />}>Open the letter for this order</Button>
                    </div>
                  ) : null}
                </div>
                {/* Built by htmlEmail: every word escaped, only our own links and bold added. */}
                <div className="px-3 py-3" onClick={onEmailClick} dangerouslySetInnerHTML={{ __html: html }} />
                <p className="border-t border-stone-100 px-3 py-2 text-xs text-stone-500">The sender's signature and the store logo go below this.</p>
              </div>
              <ul className="list-disc space-y-1 pl-5 text-xs text-stone-600">
                <li><strong>Click Here</strong> opens {d.form_ready ? "this order's own freight form, with our PO filled in" : "our freight form. This order's own link is made when its freight email is drafted; then the form fills in our PO"}.</li>
                {d.has_letter ? <li><strong>click here</strong> (routing letter) records that they received our routing instructions. From the preview it records nothing.</li> : null}
                <li>Nothing is saved or sent from this preview.</li>
              </ul>
            </>
          ) : null}
        </div>
        <div className="flex justify-end border-t border-stone-200 px-4 py-3">
          <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
