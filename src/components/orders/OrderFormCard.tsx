import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { FileSpreadsheet, Pencil, X } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { readOrderForm, sendOrderFormChanges, type FormEdit, type FormRow } from '@/services/orderForm'
import { money } from '@/lib/freight'
import { ROUTES } from '@/lib/constants'
import { errorMessage, shortDate } from '@/lib/utils'
import { Alert, Button, Input, Textarea } from '@/components/ui'
import { StickySaveBar } from '@/components/shared/StickySaveBar'

/**
 * What we ordered, straight off the vendor's own order form we emailed (Dana, Nov 13: "I need to be able to edit these
 * orders and resend. Where can I do it without downloading to my computer?"). The card lists the rows with something on
 * them; **Edit the order** opens the whole form, every item with its color boxes, and **Send the changes** writes the new
 * numbers into the same spreadsheet, files it as a revised copy, updates the order and opens the reply for the person to
 * send. Shown only for an order with an Excel order form on file.
 */
export function OrderFormCard({ orderId, canEdit, onChange }: { orderId: string; canEdit: boolean; onChange?: () => Promise<void> | void }) {
  const q = useSupabaseQuery(() => readOrderForm(orderId).catch((e: unknown) => ({ missing: errorMessage(e) })), [orderId])
  const [editing, setEditing] = useState(false)
  const navigate = useNavigate()
  const v = q.data
  if (q.isLoading) return null
  if (!v || 'missing' in v) return null   // no Excel order form on this order: nothing to show here
  const { form, lines, sent } = v
  const ordered = form.rows.filter((r) => lines.some((l) => l.row === r.row))
  const colorList = (r: FormRow) => r.inputs.filter((i) => (i.value ?? 0) > 0).map((i) => `${i.value} ${i.header ?? ''}`.trim()).join(', ')

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">What we ordered</h2>
          <p className="mt-1 text-xs text-stone-500">
            <FileSpreadsheet className="mr-1 inline size-3.5 align-text-bottom" aria-hidden="true" />{v.file_name}
            {sent ? <> · sent {shortDate(sent.on)}{sent.thread_id ? <> · <Link to={`${ROUTES.mail}/${sent.thread_id}`} className="text-brand hover:underline">the email</Link></> : null}</> : null}
          </p>
        </div>
        {canEdit && form.editable && !editing ? <Button size="sm" variant="secondary" leftIcon={<Pencil className="size-4" aria-hidden="true" />} onClick={() => setEditing(true)}>Edit the order</Button> : null}
      </div>
      {!form.editable ? <Alert variant="info" className="mt-3">{form.why ?? 'VMS could not read this form.'} The lines in Check-in pricing can still be changed by hand.</Alert> : null}
      {editing ? (
        <FormEditor orderId={orderId} fileName={v.file_name} rows={form.rows} mode={form.mode} total={form.total} onCancel={() => setEditing(false)}
          onSent={async (draftId) => { setEditing(false); await onChange?.(); navigate(`${ROUTES.mail}?view=drafts&draft=${draftId}`) }} />
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
              <tr>
                <th className="py-2 pr-3">Vendor ID</th>
                <th className="py-2 pr-3">Item</th>
                <th className="py-2 pr-3">{form.mode === 'cases' ? 'Cases by color' : 'Qty'}</th>
                {form.mode === 'cases' ? <th className="py-2 pr-3 text-right">Units</th> : null}
                <th className="py-2 pr-3 text-right">Cost</th>
                <th className="py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {ordered.map((r) => {
                const line = lines.find((l) => l.row === r.row)!
                return (
                  <tr key={r.row}>
                    <td className="py-2 pr-3 font-mono text-xs text-stone-700">{r.model}</td>
                    <td className="py-2 pr-3 text-stone-900">{r.description}</td>
                    <td className="py-2 pr-3 text-stone-700">{form.mode === 'cases' ? `${colorList(r)}${r.cpq ? ` (${r.cpq} per case)` : ''}` : line.quantity}</td>
                    {form.mode === 'cases' ? <td className="py-2 pr-3 text-right tabular-nums">{line.quantity}</td> : null}
                    <td className="py-2 pr-3 text-right tabular-nums">{r.price !== null ? money(r.price) : '—'}</td>
                    <td className="py-2 text-right tabular-nums">{money(r.total ?? line.quantity * (line.unit_cost ?? 0))}</td>
                  </tr>
                )
              })}
            </tbody>
            {form.total !== null ? (
              <tfoot>
                <tr className="border-t border-stone-200 font-medium text-stone-900">
                  <td className="py-2 pr-3" colSpan={form.mode === 'cases' ? 5 : 4}>Order total</td>
                  <td className="py-2 text-right tabular-nums">{money(form.total)}</td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}
    </section>
  )
}

/** The whole form to type into: every item under its section, a box per color. */
function FormEditor({ orderId, fileName, rows, mode, total, onCancel, onSent }: { orderId: string; fileName: string; rows: FormRow[]; mode: 'cases' | 'units'; total: number | null; onCancel: () => void; onSent: (draftId: string) => Promise<void> }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(rows.flatMap((r) => r.inputs.map((i) => [i.ref, i.value === null ? '' : String(i.value)]))))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const original = useMemo(() => Object.fromEntries(rows.flatMap((r) => r.inputs.map((i) => [i.ref, i.value]))), [rows])
  const edits: FormEdit[] = Object.entries(values).flatMap(([ref, s]) => {
    const n = s.trim() === '' ? null : Number(s)
    if (n !== null && (!Number.isFinite(n) || n < 0)) return []
    return (original[ref] ?? null) === n ? [] : [{ ref, value: n }]
  })
  const bad = Object.values(values).some((s) => s.trim() !== '' && (!Number.isFinite(Number(s)) || Number(s) < 0))
  // the figures as they will be after the changes, so the person sees them before sending
  const rowNow = (r: FormRow) => {
    const inputs = r.inputs.reduce((n, i) => n + (Number(values[i.ref] ?? '') || 0), 0)
    const units = mode === 'cases' ? inputs * (r.cpq ?? 0) : inputs
    return { cases: inputs, units, total: r.price !== null ? units * r.price : null }
  }
  const newTotal = rows.reduce((n, r) => n + (rowNow(r).total ?? 0), 0)
  const sections = rows.reduce<{ name: string | null; rows: FormRow[] }[]>((acc, r) => {
    const last = acc[acc.length - 1]
    if (last && last.name === r.section) last.rows.push(r); else acc.push({ name: r.section, rows: [r] })
    return acc
  }, [])
  const width = Math.max(...rows.map((r) => r.inputs.length))

  async function send() {
    if (bad) return
    if (!edits.length) { toast.error('Nothing has changed yet.'); return }
    setBusy(true)
    try {
      const r = await sendOrderFormChanges(orderId, edits, note)
      toast.success(`${r.file_name} is filed and the email is written. Read it over and press Send.`)
      await onSent(r.draft_id)
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-stone-50" role="dialog" aria-modal="true" aria-label="Edit the order">
    <form onSubmit={(e) => { e.preventDefault(); void send() }} className="mx-auto flex min-h-full max-w-7xl flex-col px-4 pt-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-stone-900">Edit the order</h2>
          <p className="mt-0.5 text-xs text-stone-500"><FileSpreadsheet className="mr-1 inline size-3.5 align-text-bottom" aria-hidden="true" />{fileName}</p>
        </div>
        <button type="button" onClick={onCancel} disabled={busy} aria-label="Close" className="shrink-0 rounded-md p-1.5 text-stone-500 hover:bg-stone-100"><X className="size-5" aria-hidden="true" /></button>
      </div>
      <p className="mt-2 text-sm text-stone-600">{mode === 'cases' ? 'Type the number of cases in each color box, the way the form is filled in. Clear a box to take it off.' : 'Type the quantity for each item. Clear a box to take it off.'} VMS writes the numbers into the vendor's form, files the revised copy and writes the email; you read it and press Send.</p>
      <div className="mt-3 overflow-x-auto rounded-2xl border border-stone-200 bg-white px-4">
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs font-semibold uppercase tracking-wide text-stone-500">
            <tr>
              <th className="py-2 pr-3">Vendor ID</th>
              <th className="min-w-44 py-2 pr-3">Item</th>
              <th colSpan={width} className="py-2 pr-2 text-center">{mode === 'cases' ? 'Cases by color' : 'Qty'}</th>
              <th className="py-2 pr-3 text-right">Cost</th>
              {mode === 'cases' ? <th className="py-2 pr-3 text-right">Per case</th> : null}
              <th className="py-2 pr-3 text-right">Units</th>
              <th className="py-2 text-right">Total</th>
            </tr>
          </thead>
          {sections.map((s, si) => (
            <tbody key={si} className="divide-y divide-stone-100 border-t border-stone-200">
              {s.name ? <tr><td colSpan={width + 6} className="bg-stone-50 py-1.5 pr-3 text-xs font-semibold uppercase tracking-wide text-stone-600">{s.name}</td></tr> : null}
              {s.rows.map((r) => {
                const now = rowNow(r)
                const changed = r.inputs.some((i) => (original[i.ref] ?? null) !== (values[i.ref]?.trim() === '' ? null : Number(values[i.ref])))
                return (
                  <tr key={r.row} className={changed ? 'bg-amber-50' : ''}>
                    <td className="py-1.5 pr-3 align-middle font-mono text-xs text-stone-700">{r.model}</td>
                    <td className="py-1.5 pr-3 align-middle text-stone-900">{r.description}</td>
                    {Array.from({ length: width }, (_, k) => {
                      const i = r.inputs[k]
                      if (!i || (!i.header && mode === 'cases' && r.inputs.some((x) => x.header))) return <td key={k} className="py-1.5 pr-2" />
                      return (
                        <td key={i.ref} className="py-1.5 pr-2 align-middle">
                          <label className="flex flex-col items-center gap-0.5">
                            <span className="max-w-24 truncate text-[11px] text-stone-500" title={i.header ?? undefined}>{i.header ?? (mode === 'units' ? 'Qty' : '')}</span>
                            <Input value={values[i.ref] ?? ''} onChange={(e) => setValues({ ...values, [i.ref]: e.target.value })} inputMode="numeric" aria-label={`${r.model} ${i.header ?? 'quantity'}`} className="h-8 w-14 text-center" />
                          </label>
                        </td>
                      )
                    })}
                    <td className="py-1.5 pr-3 text-right align-middle tabular-nums">{r.price !== null ? money(r.price) : '—'}</td>
                    {mode === 'cases' ? <td className="py-1.5 pr-3 text-right align-middle tabular-nums">{r.cpq ?? '—'}</td> : null}
                    <td className="py-1.5 pr-3 text-right align-middle tabular-nums">{now.units || ''}</td>
                    <td className="py-1.5 text-right align-middle tabular-nums">{now.total ? money(now.total) : ''}</td>
                  </tr>
                )
              })}
            </tbody>
          ))}
          <tfoot>
            <tr className="border-t border-stone-200 font-medium text-stone-900">
              <td className="py-2 pr-3" colSpan={width + (mode === 'cases' ? 5 : 4)}>Order total{total !== null && Math.abs(newTotal - total) > 0.004 ? <span className="ml-2 text-xs font-normal text-stone-500">was {money(total)}</span> : null}</td>
              <td className="py-2 text-right tabular-nums">{money(newTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <label className="mt-4 block text-sm">
        <span className="font-medium text-stone-700">Anything to tell them</span> <span className="text-stone-500">(optional; VMS lists the changes itself)</span>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className="mt-1 bg-white" placeholder="e.g. Paricon is out of the 130cm boards, so we are adding them here." />
      </label>
      <p className="mt-2 mb-3 text-sm text-stone-500">{edits.length ? `${edits.length} ${edits.length === 1 ? 'box' : 'boxes'} changed. ` : 'Nothing changed yet. '}Send the changes files the revised form and opens the email for you to send.</p>
      <StickySaveBar className="mt-auto" saving={busy} label={busy ? 'Writing the form and the email…' : 'Send the changes'} error={bad ? 'A box has something that is not a number.' : null} onCancel={onCancel} />
    </form>
    </div>
  )
}
