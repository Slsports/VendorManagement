import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { Plus, Trash2 } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { addItemRule, deleteItemRule, listItemRules } from '@/services/itemRules'
import { errorMessage } from '@/lib/utils'
import type { ItemRule, VendorItemRule } from '@/types'
import { Badge, Button, Input, Select, Spinner } from '@/components/ui'

const ITEM_RULE_LABELS: Record<ItemRule, string> = { reorder_first: 'Reorder first', keep: 'Keep ordering', watch: 'Watch', stop: 'Stop ordering' }
const RULE_TONE: Record<ItemRule, 'success' | 'brand' | 'warning' | 'danger'> = { reorder_first: 'success', keep: 'brand', watch: 'warning', stop: 'danger' }
const RULE_ORDER: ItemRule[] = ['reorder_first', 'keep', 'watch', 'stop']

export interface VendorItemRulesSectionProps {
  organizationId: string
  vendorId: string
  userId: string | null
  canEdit: boolean
}

/**
 * What to order from this vendor, as opposed to whether to order from them at all (that is the standing).
 * Rules sit on a product type or on one item by Vendor ID. Seeded from Dana's analyses today; the
 * Lightspeed connection will tie them to live items and let sell-through propose new ones.
 */
export function VendorItemRulesSection({ organizationId, vendorId, userId, canEdit }: VendorItemRulesSectionProps) {
  const q = useSupabaseQuery(() => listItemRules(vendorId), [vendorId])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState<{ scope: 'type' | 'item'; vendor_item_id: string; name: string; rule: ItemRule; reason: string }>({ scope: 'type', vendor_item_id: '', name: '', rule: 'keep', reason: '' })
  const [saving, setSaving] = useState(false)
  const rules = q.data ?? []
  if (!q.isLoading && !q.error && rules.length === 0 && !canEdit) return null

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      await addItemRule({ organization_id: organizationId, vendor_id: vendorId, scope: form.scope, vendor_item_id: form.scope === 'item' ? form.vendor_item_id.trim() : null, name: form.name.trim(), rule: form.rule, reason: form.reason.trim() || null, source: 'Added in VMS', as_of: new Date().toISOString().slice(0, 10), created_by: userId })
      setForm({ scope: 'type', vendor_item_id: '', name: '', rule: 'keep', reason: '' })
      setAdding(false)
      toast.success('Rule added')
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function remove(r: VendorItemRule) {
    if (!window.confirm(`Remove the rule for ${r.name}?`)) return
    try {
      await deleteItemRule(r.id)
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  const groups = (['type', 'item'] as const).map((scope) => ({ scope, rows: rules.filter((r) => r.scope === scope).sort((a, b) => RULE_ORDER.indexOf(a.rule as ItemRule) - RULE_ORDER.indexOf(b.rule as ItemRule) || a.name.localeCompare(b.name)) }))
  const sources = [...new Set(rules.map((r) => r.source).filter(Boolean))]

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">What to order from them</h2>
        {canEdit && !adding ? <Button size="sm" variant="secondary" onClick={() => setAdding(true)} leftIcon={<Plus className="size-4" aria-hidden="true" />}>Add rule</Button> : null}
      </div>
      <p className="mt-1 text-xs text-stone-500">Product types and single items to reorder first, keep, watch or stop. The standing above says whether to order from the vendor at all.{sources.length ? ` From: ${sources.join('; ')}.` : ''}</p>
      {q.isLoading ? <div className="flex justify-center py-6"><Spinner label="Loading…" className="text-brand" /></div> : q.error ? <p className="mt-2 text-sm text-red-700">{q.error}</p> : null}
      {adding ? (
        <form onSubmit={(e) => void submit(e)} className="mt-3 flex flex-col gap-2 rounded-xl border border-stone-200 p-3 sm:flex-row sm:flex-wrap sm:items-end">
          <Select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as 'type' | 'item' })} aria-label="Rule on" className="h-9 sm:w-36"><option value="type">Product type</option><option value="item">One item</option></Select>
          {form.scope === 'item' ? <Input value={form.vendor_item_id} onChange={(e) => setForm({ ...form, vendor_item_id: e.target.value })} aria-label="Vendor ID" placeholder="Vendor ID" className="h-9 sm:w-32" required /> : null}
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label={form.scope === 'item' ? 'Item name' : 'Product type'} placeholder={form.scope === 'item' ? 'Item name' : 'Product type, e.g. Squish'} className="h-9 sm:w-56" required />
          <Select value={form.rule} onChange={(e) => setForm({ ...form, rule: e.target.value as ItemRule })} aria-label="Rule" className="h-9 sm:w-40">{RULE_ORDER.map((r) => <option key={r} value={r}>{ITEM_RULE_LABELS[r]}</option>)}</Select>
          <Input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} aria-label="Why" placeholder="Why (one line)" className="h-9 sm:w-64" />
          <Button type="submit" size="sm" loading={saving}>Save</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
        </form>
      ) : null}
      {groups.map(({ scope, rows }) => rows.length ? (
        <div key={scope} className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-400">{scope === 'type' ? 'Product types' : 'Items by Vendor ID'}</h3>
          <ul className="mt-1 divide-y divide-stone-100">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <span className="font-medium text-stone-900">{r.vendor_item_id ? <span className="mr-2 font-mono text-xs text-stone-500">{r.vendor_item_id}</span> : null}{r.name}</span>
                  {r.reason ? <span className="block text-xs text-stone-600">{r.reason}</span> : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge tone={RULE_TONE[r.rule as ItemRule]}>{ITEM_RULE_LABELS[r.rule as ItemRule]}</Badge>
                  {canEdit ? <button type="button" onClick={() => void remove(r)} className="text-stone-400 hover:text-red-600" aria-label={`Remove rule for ${r.name}`}><Trash2 className="size-4" aria-hidden="true" /></button> : null}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null)}
    </section>
  )
}
