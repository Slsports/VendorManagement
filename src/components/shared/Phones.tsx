import { Phone, Plus, X } from 'lucide-react'
import { PHONE_TYPE_LABELS, phoneText, phoneTypeLabel, telHref, type ContactPhone, type PhoneType } from '@/lib/phones'
import { cn } from '@/lib/utils'
import { Input, Select } from '@/components/ui'

/** A contact's numbers to tap and call, each with its type ("Cell 559-…", "Warehouse 559-…"). */
export function PhoneLinks({ phones, className }: { phones: ContactPhone[]; className?: string }) {
  if (!phones.length) return null
  return (
    <>
      {phones.map((p, i) => (
        <a key={`${p.number}-${i}`} href={telHref(p)} className={cn('inline-flex items-center gap-1 hover:text-brand', className)}>
          <Phone className="size-3.5" aria-hidden="true" />
          <span className="text-xs text-stone-500">{phoneTypeLabel(p)}</span> {phoneText(p)}
        </a>
      ))}
    </>
  )
}

/**
 * Phone numbers in a form (Dana, Oct 13): as many as needed, each Work, Cell, Fax or Other; Other gets a box to type
 * what it is. "+ Add phone" adds a row.
 */
export function PhonesEditor({ value, onChange, idPrefix }: { value: ContactPhone[]; onChange: (next: ContactPhone[]) => void; idPrefix: string }) {
  const rows = value.length ? value : [{ number: '', type: 'work' as PhoneType }]
  const set = (i: number, patch: Partial<ContactPhone>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  return (
    <fieldset>
      <legend className="text-sm font-medium text-stone-700">Phone numbers</legend>
      <ul className="mt-1.5 space-y-2">
        {rows.map((p, i) => (
          <li key={i} className="flex flex-wrap items-center gap-2">
            <Select aria-label={`Phone ${i + 1} type`} value={p.type} onChange={(e) => set(i, { type: e.target.value as PhoneType })} className="h-10 w-28">
              {(Object.keys(PHONE_TYPE_LABELS) as PhoneType[]).map((t) => <option key={t} value={t}>{PHONE_TYPE_LABELS[t]}</option>)}
            </Select>
            {p.type === 'other' ? (
              <Input aria-label={`Phone ${i + 1}: what it is`} value={p.label ?? ''} onChange={(e) => set(i, { label: e.target.value })} placeholder="e.g. Warehouse" className="h-10 w-36" />
            ) : null}
            <Input id={i === 0 ? `${idPrefix}-phone` : undefined} aria-label={`Phone ${i + 1} number`} value={p.number} onChange={(e) => set(i, { number: e.target.value })} placeholder="559-555-0100" className="h-10 min-w-0 flex-1" inputMode="tel" />
            <Input aria-label={`Phone ${i + 1} extension`} value={p.ext ?? ''} onChange={(e) => set(i, { ext: e.target.value })} placeholder="Ext." className="h-10 w-20" />
            {rows.length > 1 || p.number ? (
              <button type="button" onClick={() => onChange(rows.filter((_, j) => j !== i))} aria-label={`Remove phone ${i + 1}`} className="rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-red-600">
                <X className="size-4" aria-hidden="true" />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => onChange([...rows, { number: '', type: 'cell' }])} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
        <Plus className="size-4" aria-hidden="true" /> Add phone
      </button>
    </fieldset>
  )
}
