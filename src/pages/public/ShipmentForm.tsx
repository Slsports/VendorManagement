import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button, FormField, Input, Select, Textarea } from '@/components/ui'

/**
 * The shipment details form a vendor opens from our email (Dana, Oct 30), no login: Pallet (LTL) or Parcel (UPS/FedEx),
 * where and when to pick up, who to call, the pallets or packages (as many as they have), and their freight quote.
 * The answers land on the order and become a freight quote for Trevor.
 */
type Method = 'pallet' | 'parcel'
interface Item { count: string; weight: string; length: string; width: string; height: string; freight_class: string; nmfc: string; stackable: boolean; hazmat: boolean; large: boolean; additional_handling: boolean; description: string }
interface Loaded { vendor: string; po: string | null; description: string | null; kind: string; method: Method | null; answered_at: string | null; answers: Record<string, unknown>; status: string }

const blank = (): Item => ({ count: '1', weight: '', length: '', width: '', height: '', freight_class: '', nmfc: '', stackable: false, hazmat: false, large: false, additional_handling: false, description: '' })
const call = async (body: Record<string, unknown>) => {
  const { data, error } = await supabase.functions.invoke('shipment-requests', { body })
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return data
}
const num = (v: string) => (v.trim() === '' ? null : Number(v.replace(/[^0-9.]/g, '')))

export default function ShipmentFormPage() {
  const { token = '' } = useParams()
  const [data, setData] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  // a look at what vendors see (Dana, Oct 31), with nothing recorded and nothing sent
  const preview = token === 'preview'
  const sample: Loaded = { vendor: 'Example Vendor Co', po: '26000', description: 'Spring order', kind: 'details', method: null, answered_at: null, answers: {}, status: 'sent' }
  useEffect(() => {
    if (preview) return
    call({ action: 'form', token }).then((d) => setData(d as Loaded)).catch(() => setError('This link is not valid. Please email orders@shaverlakesports.com.'))
  }, [token, preview])
  const shown = preview ? sample : data
  return (
    <main className="min-h-screen bg-stone-50 px-4 py-8 text-stone-900">
      <div className="mx-auto max-w-2xl">
        <img src="/brand/sls/logo-horizontal.svg" alt="Shaver Lake Sports" className="mb-6 h-16" />
        {preview ? <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Preview: this is what a vendor sees from the link in our email. Nothing you enter here is saved or sent.</p> : null}
        {error ? <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>
          : !shown ? <p className="text-sm text-stone-500">Loading…</p>
          : done ? <Thanks vendor={shown.vendor} po={shown.po} />
          : <TheForm token={token} initial={shown} onDone={setDone} preview={preview} />}
      </div>
    </main>
  )
}

function Thanks({ vendor, po }: { vendor: string; po: string | null }) {
  return (
    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6">
      <h1 className="text-xl font-semibold text-emerald-900">Thank you!</h1>
      <p className="mt-2 text-sm text-emerald-900">We have the shipment details for {vendor}{po ? `, PO ${po}` : ''}. Trevor will confirm the freight with you shortly. Please hold the shipment until then.</p>
    </div>
  )
}

function TheForm({ token, initial, onDone, preview = false }: { token: string; initial: Loaded; onDone: (m: string) => void; preview?: boolean }) {
  const a = initial.answers as Record<string, string | string[] | Item[] | undefined>
  const [method, setMethod] = useState<Method | ''>(initial.method ?? '')
  const [f, setF] = useState({
    company: (a.company as string) ?? '', address: (a.address as string) ?? '', city: (a.city as string) ?? '', state: (a.state as string) ?? '', zip: (a.zip as string) ?? '',
    contact_name: (a.contact_name as string) ?? '', contact_email: (a.contact_email as string) ?? '', contact_phone: (a.contact_phone as string) ?? '', hours: (a.hours as string) ?? '',
    ready_date: (a.ready_date as string) ?? '', quote_amount: a.quote_amount == null ? '' : String(a.quote_amount), carrier: (a.carrier as string) ?? '', notes: (a.notes as string) ?? '',
  })
  const [services, setServices] = useState<string[]>(Array.isArray(a.services) ? (a.services as string[]) : [])
  const [items, setItems] = useState<Item[]>(Array.isArray(a.items) && (a.items as Item[]).length ? (a.items as Item[]).map((i) => ({ ...blank(), ...Object.fromEntries(Object.entries(i).map(([k, v]) => [k, typeof v === 'number' ? String(v) : v ?? ''])) })) : [blank()])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const set = <K extends keyof typeof f>(k: K, v: string) => setF((x) => ({ ...x, [k]: v }))
  const setItem = (i: number, patch: Partial<Item>) => setItems((list) => list.map((it, j) => (j === i ? { ...it, ...patch } : it)))
  const isPallet = method === 'pallet'
  const unit = isPallet ? 'pallet' : 'package'
  const totalCount = items.reduce((n, i) => n + (Number(i.count) || 0), 0)
  const totalWeight = items.reduce((n, i) => n + (Number(i.count) || 0) * (Number(i.weight) || 0), 0)
  const answered = !!initial.answered_at

  async function submit() {
    setErr(null)
    if (!method) { setErr('Pick Pallet or Parcel first.'); return }
    if (!f.company.trim() || !f.zip.trim()) { setErr('Please give the pickup company and ZIP code.'); return }
    if (!f.contact_name.trim() || (!f.contact_email.trim() && !f.contact_phone.trim())) { setErr('Please give a pickup contact with an email or phone.'); return }
    if (items.some((i) => !i.weight.trim())) { setErr(`Please give the weight of each ${unit}.`); return }
    if (!f.quote_amount.trim()) { setErr('Please give your freight quote.'); return }
    if (!f.carrier.trim()) { setErr('Please tell us which carrier the quote is from.'); return }
    if (preview) { setErr('This is a preview: nothing is sent.'); return }
    setBusy(true)
    try {
      await call({ action: 'submit', token, method, answers: {
        ...f, quote_amount: f.quote_amount.replace(/[^0-9.]/g, ''), services,
        items: items.map((i) => ({ count: Number(i.count) || 1, weight: num(i.weight), length: num(i.length), width: num(i.width), height: num(i.height), freight_class: i.freight_class, nmfc: i.nmfc, stackable: i.stackable, hazmat: i.hazmat, large: i.large, additional_handling: i.additional_handling, description: i.description })),
      } })
      onDone('ok')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong. Please try again or email orders@shaverlakesports.com.')
    } finally { setBusy(false) }
  }

  const field = (label: string, k: keyof typeof f, props: Record<string, unknown> = {}) => (
    <FormField label={label} htmlFor={`sf-${k}`}><Input id={`sf-${k}`} value={f[k]} onChange={(e) => set(k, e.target.value)} {...props} /></FormField>
  )
  const tick = (label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-brand" checked={checked} onChange={(e) => onChange(e.target.checked)} />{label}</label>
  )

  return (
    <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Shipment details for Shaver Lake Sports</h1>
        <p className="mt-1 text-sm text-stone-600">{initial.vendor}{initial.po ? ` · our PO ${initial.po}` : ''}{initial.description ? ` · ${initial.description}` : ''}</p>
        {answered ? <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">You already sent this on {new Date(initial.answered_at!).toLocaleDateString()}. Sending it again replaces those answers.</p> : null}
      </header>

      <section className="rounded-2xl border border-stone-200 bg-white p-5">
        <h2 className="text-base font-semibold">How is this shipping?</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {([['pallet', 'Pallet (LTL)', 'On one or more pallets, by truck'], ['parcel', 'Parcel (UPS / FedEx)', 'Boxes, by UPS, FedEx or similar']] as const).map(([v, t, sub]) => (
            <button key={v} type="button" onClick={() => setMethod(v)} aria-pressed={method === v}
              className={`rounded-xl border p-4 text-left ${method === v ? 'border-brand bg-brand/5 ring-2 ring-brand/30' : 'border-stone-300 hover:border-stone-400'}`}>
              <span className="block font-semibold">{t}</span><span className="block text-xs text-stone-600">{sub}</span>
            </button>
          ))}
        </div>
      </section>

      {method ? (<>
        <section className="rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="text-base font-semibold">Pickup location</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">{field('Company name', 'company', { required: true })}</div>
            <div className="sm:col-span-2">{field('Street address', 'address')}</div>
            {field('City', 'city')}
            <div className="grid grid-cols-2 gap-3">{field('State', 'state')}{field('ZIP', 'zip', { required: true, inputMode: 'numeric' })}</div>
          </div>
          <h2 className="mt-5 text-base font-semibold">Contact at the pickup location</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {field('Name', 'contact_name', { required: true })}
            {field('Email', 'contact_email', { type: 'email' })}
            {field('Phone', 'contact_phone', { type: 'tel' })}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {field('Hours and days pickups are allowed', 'hours', { placeholder: 'Mon–Fri 8–3' })}
            {field('Ready for pickup on', 'ready_date', { type: 'date' })}
          </div>
          {isPallet ? (
            <div className="mt-4 flex flex-wrap gap-4">
              {tick('Residential pickup', services.includes('residential'), (v) => setServices((s) => v ? [...s, 'residential'] : s.filter((x) => x !== 'residential')))}
              {tick('Lift gate needed at pickup', services.includes('liftgate'), (v) => setServices((s) => v ? [...s, 'liftgate'] : s.filter((x) => x !== 'liftgate')))}
              {tick('Limited access location', services.includes('limited_access'), (v) => setServices((s) => v ? [...s, 'limited_access'] : s.filter((x) => x !== 'limited_access')))}
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="text-base font-semibold">{isPallet ? 'Pallets' : 'Packages'}</h2>
          <p className="mt-1 text-xs text-stone-600">{isPallet ? 'One block per pallet. Add as many as you have.' : 'One block per package size. Identical packages go in one block with the count.'}</p>
          <ol className="mt-3 space-y-4">
            {items.map((it, i) => (
              <li key={i} className="rounded-xl border border-stone-200 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{isPallet ? `Pallet ${i + 1}` : `Package ${i + 1}`}</h3>
                  {items.length > 1 ? <button type="button" onClick={() => setItems((l) => l.filter((_, j) => j !== i))} className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-red-700"><Trash2 className="size-3.5" aria-hidden="true" />Remove</button> : null}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <FormField label={isPallet ? 'Pieces on it' : 'How many identical'} htmlFor={`it-${i}-count`}><Input id={`it-${i}-count`} inputMode="numeric" value={it.count} onChange={(e) => setItem(i, { count: e.target.value })} /></FormField>
                  <FormField label={isPallet ? 'Weight (lbs)' : 'Weight each (lbs)'} htmlFor={`it-${i}-w`}><Input id={`it-${i}-w`} inputMode="decimal" value={it.weight} onChange={(e) => setItem(i, { weight: e.target.value })} required /></FormField>
                  <FormField label="Length (in)" htmlFor={`it-${i}-l`}><Input id={`it-${i}-l`} inputMode="decimal" value={it.length} onChange={(e) => setItem(i, { length: e.target.value })} /></FormField>
                  <FormField label="Width (in)" htmlFor={`it-${i}-wd`}><Input id={`it-${i}-wd`} inputMode="decimal" value={it.width} onChange={(e) => setItem(i, { width: e.target.value })} /></FormField>
                  <FormField label="Height (in)" htmlFor={`it-${i}-h`}><Input id={`it-${i}-h`} inputMode="decimal" value={it.height} onChange={(e) => setItem(i, { height: e.target.value })} /></FormField>
                </div>
                {isPallet ? (
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <FormField label="Freight class (if known)" htmlFor={`it-${i}-c`}><Select id={`it-${i}-c`} value={it.freight_class} onChange={(e) => setItem(i, { freight_class: e.target.value })}><option value="">Not sure</option>{['50', '55', '60', '65', '70', '77.5', '85', '92.5', '100', '110', '125', '150', '175', '200', '250', '300', '400', '500'].map((c) => <option key={c} value={c}>{c}</option>)}</Select></FormField>
                    <FormField label="NMFC (if known)" htmlFor={`it-${i}-n`}><Input id={`it-${i}-n`} value={it.nmfc} onChange={(e) => setItem(i, { nmfc: e.target.value })} /></FormField>
                    <div className="flex flex-col justify-end gap-2 pb-1">{tick('Stackable', it.stackable, (v) => setItem(i, { stackable: v }))}{tick('Hazmat', it.hazmat, (v) => setItem(i, { hazmat: v }))}</div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-4">{tick('Large package', it.large, (v) => setItem(i, { large: v }))}{tick('Additional handling', it.additional_handling, (v) => setItem(i, { additional_handling: v }))}</div>
                )}
                <div className="mt-3"><FormField label={isPallet ? "What's on it" : "What's in them"} htmlFor={`it-${i}-d`}><Input id={`it-${i}-d`} value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} placeholder="e.g. 12 cases of coolers" /></FormField></div>
              </li>
            ))}
          </ol>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <Button type="button" variant="secondary" size="sm" onClick={() => setItems((l) => [...l, blank()])} leftIcon={<Plus className="size-4" aria-hidden="true" />}>{isPallet ? 'Add another pallet' : 'Add another package'}</Button>
            <p className="text-sm text-stone-700">{isPallet ? `${items.length} pallet${items.length === 1 ? '' : 's'}` : `${totalCount} package${totalCount === 1 ? '' : 's'}`} · {totalWeight.toLocaleString()} lbs total</p>
          </div>
        </section>

        <section className="rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="text-base font-semibold">Your freight quote</h2>
          {isPallet ? <p className="mt-1 text-sm text-stone-700">Please quote delivery to Shaver Lake, CA 93664. We do not need a lift gate: we have a forklift.</p> : null}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {field('Quote amount ($)', 'quote_amount', { required: true, inputMode: 'decimal', placeholder: '0.00' })}
            {field('Carrier the quote is from', 'carrier', { required: true, placeholder: isPallet ? 'e.g. Estes, XPO, Old Dominion' : 'e.g. UPS Ground, FedEx Ground' })}
          </div>
          <div className="mt-3"><FormField label="Anything else we should know" htmlFor="sf-notes"><Textarea id="sf-notes" rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></FormField></div>
        </section>

        {err ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p> : null}
        <div className="flex items-center gap-3">
          <Button type="submit" loading={busy}>Send to Shaver Lake Sports</Button>
          <span className="text-xs text-stone-500">Questions? orders@shaverlakesports.com</span>
        </div>
      </>) : null}
    </form>
  )
}
