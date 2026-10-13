import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CheckCircle2, Plus, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { CONTACT_TYPE_LABELS } from '@/lib/vendors'
import { cleanPhones, type ContactPhone } from '@/lib/phones'
import { PhonesEditor } from '@/components/shared/Phones'
import { Button, FormField, Input, Spinner, Textarea } from '@/components/ui'
import type { ContactType } from '@/types'

interface Person { id?: string; name: string | null; title: string | null; email: string | null; phones: ContactPhone[]; roles?: ContactType[]; remove?: boolean }
interface FormData {
  confirmed_at: string | null; me_id: string | null
  company: { name: string; address: string | null; city: string | null; state: string | null; postal_code: string | null; phone: string | null; website: string | null }
  people: Person[]; order_methods: string[]; minimum_order: string | null; freight_programs: string | null; categories: string[]
}
type Who = { id?: string; name?: string; email?: string } | null

const METHODS: [string, string][] = [['email', 'Email'], ['phone', 'Phone'], ['nuorder', 'NuORDER'], ['website', 'Website']]
const ROLES = (Object.keys(CONTACT_TYPE_LABELS) as ContactType[]).filter((r) => r !== 'other')
const call = async (body: Record<string, unknown>) => {
  const { data, error } = await supabase.functions.invoke('vendor-public', { body })
  if (error) throw error
  return data
}

/**
 * The vendor's own form (Dana, Oct 13): "please confirm their data and have them fill out our form that updates directly
 * to vms and marks them as 'confirmed'." Everything is filled in from VMS; Looks good confirms as is, Submit changes
 * saves what they changed. No login: the link in their email is the key to this one form.
 */
export default function VendorConfirmFormPage() {
  const { token = '' } = useParams()
  const [data, setData] = useState<FormData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  useEffect(() => {
    call({ action: 'form', token }).then((d) => setData(d as FormData)).catch(() => setError('This link is not valid. Please email orders@shaverlakesports.com.'))
  }, [token])
  return (
    <main className="min-h-dvh bg-stone-50 px-4 py-8">
      <div className="mx-auto max-w-2xl">
        <img src="/brand/sls/email-logo@2x.png" alt="Shaver Lake Sports" width={240} height={31} className="mb-6 h-auto w-60" />
        {error ? <p className="rounded-2xl border border-stone-200 bg-white p-6 text-stone-700">{error}</p>
          : done ? (
            <div className="rounded-2xl border border-stone-200 bg-white p-6">
              <h1 className="flex items-center gap-2 text-xl font-semibold text-stone-900"><CheckCircle2 className="size-6 text-green-600" aria-hidden="true" />Thank you!</h1>
              <p className="mt-3 text-stone-700">{done}</p>
              <p className="mt-6 text-xs text-stone-500">Questions: orders@shaverlakesports.com · 559-841-2740</p>
            </div>
          )
          : !data ? <div className="flex justify-center py-16"><Spinner label="Loading your information…" className="text-brand" /></div>
          : <TheForm token={token} initial={data} onDone={setDone} />}
      </div>
    </main>
  )
}

function TheForm({ token, initial, onDone }: { token: string; initial: FormData; onDone: (msg: string) => void }) {
  const meStart = initial.people.find((p) => p.id === initial.me_id) ?? { name: '', title: '', email: '', phones: [], roles: [] }
  const [me, setMe] = useState<Person>({ ...meStart, phones: meStart.phones ?? [], roles: meStart.roles ?? [] })
  const [company, setCompany] = useState(initial.company)
  const [people, setPeople] = useState<Person[]>(initial.people.filter((p) => p.id !== initial.me_id).map((p) => ({ ...p, phones: p.phones ?? [] })))
  const [added, setAdded] = useState<Person[]>([])
  const pick = (role: ContactType): Who => {
    const all = [{ ...me, id: initial.me_id ?? undefined }, ...people]
    const p = all.find((x) => x.roles?.includes(role))
    return p?.id ? { id: p.id } : null
  }
  const [poTo, setPoTo] = useState<Who>(pick('orders'))
  const [quotesTo, setQuotesTo] = useState<Who>(pick('shipping'))
  const [invoicesTo, setInvoicesTo] = useState<Who>(pick('ap'))
  const [methods, setMethods] = useState<string[]>(initial.order_methods ?? [])
  const [minimum, setMinimum] = useState(initial.minimum_order ?? '')
  const [freight, setFreight] = useState(initial.freight_programs ?? '')
  const [represents, setRepresents] = useState<string[]>([''])
  const [categories, setCategories] = useState<string[]>(initial.categories ?? [])
  const [newCategory, setNewCategory] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const payload = useMemo(() => ({
    me: { name: me.name, title: me.title, email: me.email, phones: cleanPhones(me.phones), roles: me.roles },
    company,
    people: [...people.map((p) => ({ id: p.id, name: p.name, title: p.title, phones: cleanPhones(p.phones), remove: p.remove })), ...added.filter((p) => p.email?.trim()).map((p) => ({ name: p.name, title: p.title, email: p.email, phones: cleanPhones(p.phones) }))],
    po_to: poTo, quotes_to: quotesTo, invoices_to: invoicesTo,
    order_methods: methods, minimum_order: minimum, freight_programs: freight,
    represents: represents.map((r) => r.trim()).filter(Boolean), categories,
  }), [me, company, people, added, poTo, quotesTo, invoicesTo, methods, minimum, freight, represents, categories])
  const startJson = useMemo(() => JSON.stringify(payload), []) // eslint-disable-line react-hooks/exhaustive-deps
  const changed = JSON.stringify(payload) !== startJson

  async function submit(looksGood: boolean) {
    setBusy(true)
    setErr(null)
    try {
      const r = await call({ action: 'submit', token, looks_good: looksGood, payload: looksGood ? {} : payload }) as { vendor: string }
      onDone(looksGood ? `Your information for ${r.vendor} is confirmed.` : `Your changes for ${r.vendor} are saved and your information is confirmed.`)
    } catch {
      setErr('Something went wrong saving this. Please try again, or email orders@shaverlakesports.com.')
      setBusy(false)
    }
  }

  const everyone = [{ id: initial.me_id ?? undefined, name: me.name, email: me.email }, ...people.filter((p) => !p.remove)]
  const section = 'rounded-2xl border border-stone-200 bg-white p-5'
  return (
    <div className="space-y-4 pb-24">
      <div className={section}>
        <h1 className="text-xl font-semibold text-stone-900">Hi {me.name?.split(' ')[0] || 'there'},</h1>
        <p className="mt-2 text-stone-700">Here's what Shaver Lake Sports has on file for <strong>{initial.company.name}</strong>. Please take 2 minutes to check it. If it's all correct, click <strong>Looks good</strong>.</p>
        {initial.confirmed_at ? <p className="mt-2 text-sm text-green-700">You confirmed this on {new Date(initial.confirmed_at).toLocaleDateString()}. You can still make changes.</p> : null}
        <Button className="mt-4" loading={busy && !changed} disabled={busy || changed} onClick={() => void submit(true)}>Looks good</Button>
        {changed ? <p className="mt-2 text-xs text-stone-500">You've made changes: use <strong>Submit changes</strong> at the bottom.</p> : null}
      </div>

      <section className={section}>
        <h2 className="font-semibold text-stone-900">Your details</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <FormField label="Name" htmlFor="me-name"><Input id="me-name" value={me.name ?? ''} onChange={(e) => setMe({ ...me, name: e.target.value })} /></FormField>
          <FormField label="Title" htmlFor="me-title"><Input id="me-title" value={me.title ?? ''} onChange={(e) => setMe({ ...me, title: e.target.value })} /></FormField>
          <FormField label="Email" htmlFor="me-email" className="sm:col-span-2"><Input id="me-email" type="email" value={me.email ?? ''} onChange={(e) => setMe({ ...me, email: e.target.value })} /></FormField>
          <div className="sm:col-span-2"><PhonesEditor idPrefix="me" value={me.phones} onChange={(phones) => setMe({ ...me, phones })} /></div>
        </div>
        <fieldset className="mt-3">
          <legend className="text-sm font-medium text-stone-700">What do you do for us? (tick all that fit)</legend>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-2">
            {ROLES.map((r) => (
              <label key={r} className="flex items-center gap-1.5 text-sm text-stone-700">
                <input type="checkbox" className="size-4 accent-brand" checked={!!me.roles?.includes(r)} onChange={(e) => setMe({ ...me, roles: e.target.checked ? [...(me.roles ?? []), r] : (me.roles ?? []).filter((x) => x !== r) })} />{CONTACT_TYPE_LABELS[r]}
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className={section}>
        <h2 className="font-semibold text-stone-900">Your company</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <FormField label="Company name" htmlFor="co-name" className="sm:col-span-2"><Input id="co-name" value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} /></FormField>
          <FormField label="Address" htmlFor="co-address" className="sm:col-span-2"><Input id="co-address" value={company.address ?? ''} onChange={(e) => setCompany({ ...company, address: e.target.value })} /></FormField>
          <FormField label="City" htmlFor="co-city"><Input id="co-city" value={company.city ?? ''} onChange={(e) => setCompany({ ...company, city: e.target.value })} /></FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="State" htmlFor="co-state"><Input id="co-state" value={company.state ?? ''} onChange={(e) => setCompany({ ...company, state: e.target.value })} /></FormField>
            <FormField label="Zip" htmlFor="co-zip"><Input id="co-zip" value={company.postal_code ?? ''} onChange={(e) => setCompany({ ...company, postal_code: e.target.value })} /></FormField>
          </div>
          <FormField label="Main phone" htmlFor="co-phone"><Input id="co-phone" value={company.phone ?? ''} onChange={(e) => setCompany({ ...company, phone: e.target.value })} /></FormField>
          <FormField label="Website" htmlFor="co-web"><Input id="co-web" value={company.website ?? ''} onChange={(e) => setCompany({ ...company, website: e.target.value })} /></FormField>
        </div>
      </section>

      <section className={section}>
        <h2 className="font-semibold text-stone-900">Others at your company we have on file</h2>
        {people.length ? (
          <ul className="mt-3 space-y-3">
            {people.map((p, i) => (
              <li key={p.id} className={`rounded-xl border p-3 ${p.remove ? 'border-red-200 bg-red-50' : 'border-stone-200'}`}>
                <p className="text-sm font-medium text-stone-900">{p.email}</p>
                {!p.remove ? (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <Input aria-label="Name" placeholder="Name" value={p.name ?? ''} onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                    <Input aria-label="Title" placeholder="Title" value={p.title ?? ''} onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                    <div className="sm:col-span-2"><PhonesEditor idPrefix={`p${i}`} value={p.phones} onChange={(phones) => setPeople(people.map((x, j) => (j === i ? { ...x, phones } : x)))} /></div>
                  </div>
                ) : null}
                <label className="mt-2 flex items-center gap-1.5 text-sm text-stone-700"><input type="checkbox" className="size-4 accent-brand" checked={!!p.remove} onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, remove: e.target.checked } : x)))} />No longer works here</label>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-stone-500">Nobody else yet.</p>}
        {added.map((p, i) => (
          <div key={i} className="mt-3 grid gap-2 rounded-xl border border-brand/30 p-3 sm:grid-cols-3">
            <Input aria-label="Name" placeholder="Name" value={p.name ?? ''} onChange={(e) => setAdded(added.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <Input aria-label="Title" placeholder="Title" value={p.title ?? ''} onChange={(e) => setAdded(added.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
            <Input aria-label="Email" type="email" placeholder="Email" value={p.email ?? ''} onChange={(e) => setAdded(added.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)))} />
            <div className="sm:col-span-3"><PhonesEditor idPrefix={`a${i}`} value={p.phones} onChange={(phones) => setAdded(added.map((x, j) => (j === i ? { ...x, phones } : x)))} /></div>
          </div>
        ))}
        <button type="button" onClick={() => setAdded([...added, { name: '', title: '', email: '', phones: [] }])} className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"><Plus className="size-4" aria-hidden="true" />Add a person</button>
      </section>

      <section className={section}>
        <h2 className="font-semibold text-stone-900">Who should we contact?</h2>
        <div className="mt-3 space-y-3">
          <WhoPicker label="Who should receive our purchase orders?" people={everyone} added={added} value={poTo} onChange={setPoTo} />
          <WhoPicker label="Who sends freight quotes and tracking?" people={everyone} added={added} value={quotesTo} onChange={setQuotesTo} />
          <WhoPicker label="Who handles invoices and statements?" people={everyone} added={added} value={invoicesTo} onChange={setInvoicesTo} />
        </div>
      </section>

      <section className={section}>
        <h2 className="font-semibold text-stone-900">Ordering</h2>
        <fieldset className="mt-3">
          <legend className="text-sm font-medium text-stone-700">How do you take orders?</legend>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-2">
            {METHODS.map(([v, l]) => <label key={v} className="flex items-center gap-1.5 text-sm text-stone-700"><input type="checkbox" className="size-4 accent-brand" checked={methods.includes(v)} onChange={(e) => setMethods(e.target.checked ? [...methods, v] : methods.filter((x) => x !== v))} />{l}</label>)}
          </div>
        </fieldset>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <FormField label="Minimum order" htmlFor="min"><Input id="min" value={minimum} onChange={(e) => setMinimum(e.target.value)} placeholder="$" /></FormField>
          <FormField label="Any freight programs you have" htmlFor="freight" className="sm:col-span-2" hint="For example: Free freight at $1,500, or 50% freight allowance at $1,000">
            <Textarea id="freight" rows={3} value={freight} onChange={(e) => setFreight(e.target.value)} />
          </FormField>
        </div>
      </section>

      <section className={section}>
        <h2 className="font-semibold text-stone-900">Do you represent any other vendors?</h2>
        <p className="mt-1 text-sm text-stone-600">One company per box.</p>
        <div className="mt-3 space-y-2">
          {represents.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input aria-label={`Other vendor ${i + 1}`} value={r} onChange={(e) => setRepresents(represents.map((x, j) => (j === i ? e.target.value : x)))} placeholder="Company name" />
              {represents.length > 1 ? <button type="button" onClick={() => setRepresents(represents.filter((_, j) => j !== i))} aria-label="Remove" className="rounded-md p-1.5 text-stone-400 hover:text-red-600"><X className="size-4" aria-hidden="true" /></button> : null}
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setRepresents([...represents, ''])} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"><Plus className="size-4" aria-hidden="true" />Add another</button>
      </section>

      <section className={section}>
        <h2 className="font-semibold text-stone-900">What product categories do you sell?</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {categories.map((c) => (
            <span key={c} className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-3 py-1 text-sm text-stone-800">{c}
              <button type="button" onClick={() => setCategories(categories.filter((x) => x !== c))} aria-label={`Remove ${c}`} className="text-stone-400 hover:text-red-600"><X className="size-3.5" aria-hidden="true" /></button>
            </span>
          ))}
          {!categories.length ? <span className="text-sm text-stone-500">None yet.</span> : null}
        </div>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); const c = newCategory.trim(); if (c && !categories.some((x) => x.toLowerCase() === c.toLowerCase())) setCategories([...categories, c]); setNewCategory('') }}>
          <Input aria-label="Add a category" value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="e.g. Fishing tackle" />
          <Button type="submit" variant="secondary" leftIcon={<Plus className="size-4" aria-hidden="true" />}>Add a category</Button>
        </form>
      </section>

      <div className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-end gap-2">
          {err ? <p className="mr-auto text-sm text-red-700">{err}</p> : null}
          <Button variant="secondary" disabled={busy || changed} onClick={() => void submit(true)}>Looks good</Button>
          <Button loading={busy && changed} disabled={busy || !changed} onClick={() => void submit(false)}>Submit changes</Button>
        </div>
      </div>
    </div>
  )
}

/** One of "who should receive…": a person on file, or someone else (name + email). */
function WhoPicker({ label, people, added, value, onChange }: { label: string; people: { id?: string; name: string | null; email: string | null }[]; added: Person[]; value: Who; onChange: (w: Who) => void }) {
  const others = added.filter((p) => p.email?.trim())
  const current = value?.id ? `id:${value.id}` : value?.email ? (others.some((p) => p.email === value.email) ? `new:${value.email}` : 'else') : ''
  const [elseName, setElseName] = useState(value?.id ? '' : value?.name ?? '')
  const [elseEmail, setElseEmail] = useState(value?.id ? '' : value?.email ?? '')
  return (
    <div>
      <label className="text-sm font-medium text-stone-700">{label}
        <select value={current} onChange={(e) => {
          const v = e.target.value
          if (v.startsWith('id:')) onChange({ id: v.slice(3) })
          else if (v.startsWith('new:')) { const p = others.find((x) => x.email === v.slice(4)); onChange({ name: p?.name ?? '', email: p?.email ?? '' }) }
          else if (v === 'else') onChange({ name: elseName, email: elseEmail })
          else onChange(null)
        }} className="mt-1 block h-10 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm">
          <option value="">Choose…</option>
          {people.filter((p) => p.id).map((p) => <option key={p.id} value={`id:${p.id}`}>{p.name ? `${p.name} (${p.email})` : p.email}</option>)}
          {others.map((p) => <option key={p.email!} value={`new:${p.email}`}>{p.name ? `${p.name} (${p.email})` : p.email}</option>)}
          <option value="else">Someone else…</option>
        </select>
      </label>
      {current === 'else' ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <Input aria-label="Name" placeholder="Name" value={elseName} onChange={(e) => { setElseName(e.target.value); onChange({ name: e.target.value, email: elseEmail }) }} />
          <Input aria-label="Email" type="email" placeholder="Email" value={elseEmail} onChange={(e) => { setElseEmail(e.target.value); onChange({ name: elseName, email: e.target.value }) }} />
        </div>
      ) : null}
    </div>
  )
}
