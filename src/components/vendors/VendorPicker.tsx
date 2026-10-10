import { useId, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Plus } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { clearPickerCache, listVendorNames, type VendorRef } from '@/services/mail'
import { createVendor, setVendorRoutes, updateVendor } from '@/services/vendors'
import { BILLING_ROUTE_LABELS } from '@/lib/vendors'
import { cn, errorMessage } from '@/lib/utils'
import type { BillingRoute } from '@/types'
import { Modal } from '@/components/shared/Modal'
import { FormField, Input } from '@/components/ui'

const MAX_SHOWN = 40
const ROUTES: BillingRoute[] = ['worldwide', 'faire', 'direct']

/** What a new vendor starts with when added from the picker (guessed from the email being filed). */
export interface NewVendorPrefill { name?: string; email?: string; website?: string }

/**
 * Type-ahead vendor picker used everywhere a vendor is chosen.
 * "+ Add new vendor…" is the first choice (a small pop-up, picked on save). Inactive vendors are listed
 * after the active ones, grayed out; choosing one asks to reactivate it, without leaving the screen.
 */
export function VendorPicker({ onPick, prefill, placeholder = 'Type a vendor name', className, autoFocus }: {
  onPick: (v: VendorRef) => void | Promise<void>
  prefill?: NewVendorPrefill
  placeholder?: string
  className?: string
  autoFocus?: boolean
}) {
  const { organization } = useAuth()
  const q = useSupabaseQuery(async () => (organization ? listVendorNames(organization.id) : []), [organization?.id])
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [reactivate, setReactivate] = useState<VendorRef | null>(null)
  const [adding, setAdding] = useState(false)
  const listId = useId()

  const matches = useMemo(() => {
    const s = text.trim().toLowerCase()
    const all = q.data ?? []
    const hit = s ? all.filter((v) => v.name.toLowerCase().includes(s)) : all
    const starts = (v: VendorRef) => (s && v.name.toLowerCase().startsWith(s) ? 0 : 1)
    return [...hit].sort((a, b) => Number(!a.is_active) - Number(!b.is_active) || starts(a) - starts(b) || a.name.localeCompare(b.name)).slice(0, MAX_SHOWN)
  }, [q.data, text])
  // Row 0 is always "+ Add new vendor…".
  const rows = matches.length + 1

  function choose(index: number) {
    setOpen(false)
    if (index === 0) { setAdding(true); return }
    const v = matches[index - 1]
    if (!v) return
    if (!v.is_active) { setReactivate(v); return }
    setText(v.name)
    void onPick(v)
  }

  return (
    <div className={cn('relative', className)}>
      <Input
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-label="Vendor"
        value={text}
        autoFocus={autoFocus}
        placeholder={q.isLoading ? 'Loading vendors…' : placeholder}
        className="h-9"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setText(e.target.value); setOpen(true); setActive(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, rows - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
          else if (e.key === 'Enter' && open) { e.preventDefault(); choose(active) }
          else if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open ? (
        <ul id={listId} role="listbox" className="absolute z-40 mt-1 max-h-72 w-full min-w-64 overflow-y-auto rounded-lg border border-stone-200 bg-white py-1 text-sm shadow-lg">
          <li role="option" aria-selected={active === 0} onMouseDown={(e) => { e.preventDefault(); choose(0) }}
            className={cn('flex cursor-pointer items-center gap-1.5 px-3 py-2 font-medium text-brand', active === 0 && 'bg-stone-100')}>
            <Plus className="size-4" aria-hidden="true" /> Add new vendor{text.trim() ? ` "${text.trim()}"` : '…'}
          </li>
          {matches.map((v, i) => (
            <li key={v.id} role="option" aria-selected={active === i + 1} onMouseDown={(e) => { e.preventDefault(); choose(i + 1) }}
              className={cn('flex cursor-pointer items-center justify-between gap-2 px-3 py-2', active === i + 1 && 'bg-stone-100', v.is_active ? 'text-stone-900' : 'text-stone-400')}>
              <span className="truncate">{v.name}</span>
              {!v.is_active ? <span className="shrink-0 text-xs">inactive</span> : null}
            </li>
          ))}
          {!q.isLoading && matches.length === 0 ? <li className="px-3 py-2 text-stone-500">No vendor by that name.</li> : null}
        </ul>
      ) : null}

      {reactivate ? (
        <ReactivateDialog vendor={reactivate} onClose={() => setReactivate(null)} onDone={(v) => { setReactivate(null); setText(v.name); void onPick(v); void q.refetch() }} />
      ) : null}
      {adding ? (
        <QuickVendorDialog
          prefill={{ ...prefill, name: text.trim() || prefill?.name }}
          onClose={() => setAdding(false)}
          onDone={(v) => { setAdding(false); setText(v.name); void onPick(v); void q.refetch() }}
        />
      ) : null}
    </div>
  )
}

function ReactivateDialog({ vendor, onClose, onDone }: { vendor: VendorRef; onClose: () => void; onDone: (v: VendorRef) => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="Reactivate this vendor?" submitLabel="Reactivate and use" busy={busy} onClose={onClose} onSubmit={async () => {
      setBusy(true)
      try {
        await updateVendor(vendor.id, { is_active: true })
        clearPickerCache()
        toast.success(`${vendor.name} is active again`)
        onDone({ ...vendor, is_active: true })
      } catch (err) {
        toast.error(errorMessage(err))
        setBusy(false)
      }
    }}>
      <p className="text-stone-700"><span className="font-medium">{vendor.name}</span> is inactive. Reactivate it and use it here?</p>
    </Modal>
  )
}

/** Name, usual billing route and orders email; the rest is added later on the vendor page. */
export function QuickVendorDialog({ prefill, onClose, onDone }: { prefill?: NewVendorPrefill; onClose: () => void; onDone: (v: VendorRef) => void }) {
  const { organization, profile } = useAuth()
  const [name, setName] = useState(prefill?.name ?? '')
  const [route, setRoute] = useState<BillingRoute | ''>('')
  const [email, setEmail] = useState(prefill?.email ?? '')
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="Add a new vendor" submitLabel="Add vendor" busy={busy} onClose={onClose} onSubmit={async () => {
      if (!organization || !profile) return
      if (!name.trim()) { toast.error('Name is required.'); return }
      if (email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { toast.error('That email does not look right.'); return }
      setBusy(true)
      try {
        const v = await createVendor({ organization_id: organization.id, name: name.trim(), email: email.trim() || null, website: prefill?.website || null, created_by: profile.id })
        if (route) await setVendorRoutes(v.id, [{ route, is_default: true }])
        clearPickerCache()
        toast.success(`${v.name} added`)
        onDone({ id: v.id, name: v.name, is_active: true })
      } catch (err) {
        toast.error(errorMessage(err))
        setBusy(false)
      }
    }}>
      <FormField label="Name" htmlFor="qv-name"><Input id="qv-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required /></FormField>
      <fieldset>
        <legend className="text-sm font-medium text-stone-800">Billed through</legend>
        <div className="mt-1 flex flex-wrap gap-3">
          {ROUTES.map((r) => (
            <label key={r} className="flex items-center gap-2 text-stone-700">
              <input type="radio" name="qv-route" checked={route === r} onChange={() => setRoute(r)} className="accent-brand" /> {r === 'worldwide' ? 'WWD (Worldwide)' : BILLING_ROUTE_LABELS[r]}
            </label>
          ))}
        </div>
      </fieldset>
      <FormField label="Orders email" htmlFor="qv-email"><Input id="qv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></FormField>
      <p className="text-xs text-stone-500">Add the rest later on the vendor page.</p>
    </Modal>
  )
}
