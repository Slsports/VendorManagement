import { useId, useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { Plus, Trash2, Wand2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { applyReviewRules, createReviewRule, deleteReviewRule, listCategoryNames, listPeople, listReviewRules, proposeCategoryAssignments, updateReviewRule } from '@/services/reviews'
import { categorySuggestions, describeRule, REVIEW_KIND_LABELS, REVIEW_RULE_KIND_LABELS, REVIEW_RULE_PRIORITY } from '@/lib/reviews'
import { cn } from '@/lib/utils'
import { errorMessage } from '@/lib/utils'
import type { ReviewAssignmentRule, ReviewRuleKind } from '@/types'
import { AssigneeSelect } from '@/components/review/AssigneeSelect'
import { Alert, Button, Input, Select, Spinner } from '@/components/ui'

/** Rule kinds an admin can add here. 'vendor' rules exist in the schema for later; the vendor page will add them. */
const ADDABLE: ReviewRuleKind[] = ['fishing', 'department', 'review_kind', 'fallback']

/**
 * Who gets which review items. Rules run top to bottom (priority, then the most specific kind);
 * the first match assigns the item when it is created. "Apply now" runs them over items already waiting.
 */
export default function ReviewAssignmentSettings() {
  const { organization, role, profile } = useAuth()
  const isAdmin = role === 'admin'
  const rulesQ = useSupabaseQuery(async () => (organization ? listReviewRules(organization.id) : []), [organization?.id])
  const peopleQ = useSupabaseQuery(async () => (organization ? listPeople(organization.id) : []), [organization?.id])
  const categoriesQ = useSupabaseQuery(async () => (organization ? listCategoryNames(organization.id) : []), [organization?.id])
  const [form, setForm] = useState<{ kind: ReviewRuleKind; value: string; assignee: string }>({ kind: 'fishing', value: '', assignee: '' })
  const [saving, setSaving] = useState(false)
  const [applying, setApplying] = useState(false)
  const [overwrite, setOverwrite] = useState(false)

  if (rulesQ.isLoading || peopleQ.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading…" className="text-brand" /></div>
  if (rulesQ.error) return <Alert variant="error">{rulesQ.error}</Alert>
  if (peopleQ.error) return <Alert variant="error">{peopleQ.error}</Alert>
  if (!organization) return null
  const rules = rulesQ.data ?? []
  const people = peopleQ.data ?? []
  const nameOf = (id: string) => people.find((p) => p.id === id)?.full_name ?? 'Former user'
  const needsValue = form.kind === 'department' || form.kind === 'review_kind'

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!form.assignee || (needsValue && !form.value.trim())) return
    setSaving(true)
    try {
      const rule = await createReviewRule({
        organization_id: organization!.id,
        match_kind: form.kind,
        // Categories keep their Lightspeed spelling ("Camping/Coolers"); matching ignores case.
        match_value: needsValue ? form.value.trim() : null,
        assignee_id: form.assignee,
        priority: REVIEW_RULE_PRIORITY[form.kind],
        created_by: profile?.id ?? null,
      })
      setForm({ kind: 'fishing', value: '', assignee: '' })
      const proposed = rule.match_kind === 'department' ? await proposeCategoryAssignments(rule.id) : 0
      toast.success(proposed ? `Rule added. ${proposed} vendor${proposed === 1 ? '' : 's'} in it with nobody ordering went to the review queue.` : 'Rule added')
      await rulesQ.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  async function change(rule: ReviewAssignmentRule, changes: Parameters<typeof updateReviewRule>[1]) {
    try {
      await updateReviewRule(rule.id, changes)
      await rulesQ.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  async function remove(rule: ReviewAssignmentRule) {
    if (!window.confirm(`Remove this rule? ${describeRule(rule)} → ${nameOf(rule.assignee_id)}`)) return
    try {
      await deleteReviewRule(rule.id)
      await rulesQ.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  async function applyNow() {
    setApplying(true)
    try {
      const n = await applyReviewRules(organization!.id, overwrite)
      toast.success(n ? `${n} item${n === 1 ? '' : 's'} assigned` : 'Nothing to change')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-8">
      <section>
        <h2 className="text-base font-semibold text-stone-900">Who gets which reviews</h2>
        <p className="mt-1 text-sm text-stone-600">
          When a review item is created, these rules run top to bottom and the first match assigns it. Anyone with edit rights can still hand an item to someone else from the queue.
          The same rules will route the Lightspeed category clean-up batches.
        </p>
        {rules.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-stone-300 px-4 py-6 text-center text-sm text-stone-600">No rules yet. Items wait unassigned until someone picks them up.</p>
        ) : (
          <ul className="mt-4 divide-y divide-stone-200 rounded-xl border border-stone-200">
            {rules.map((r) => (
              <li key={r.id} className={`flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${r.is_active ? '' : 'opacity-60'}`}>
                <div className="min-w-0">
                  <p className="font-medium text-stone-900">{describeRule(r)}</p>
                  <p className="text-xs text-stone-500">{REVIEW_RULE_KIND_LABELS[r.match_kind]} · runs at {r.priority}{r.note ? ` · ${r.note}` : ''}</p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <span className="text-stone-500">goes to</span>
                  {isAdmin ? (
                    <AssigneeSelect value={r.assignee_id} people={people} label={`Assignee for: ${describeRule(r)}`} className="h-9 w-44" onChange={(id) => (id ? change(r, { assignee_id: id }) : undefined)} />
                  ) : <span className="font-medium text-stone-900">{nameOf(r.assignee_id)}</span>}
                  {isAdmin ? (
                    <>
                      <label className="flex items-center gap-1 text-xs text-stone-600"><input type="checkbox" checked={r.is_active} onChange={(e) => void change(r, { is_active: e.target.checked })} /> On</label>
                      <Button size="sm" variant="ghost" onClick={() => void remove(r)} aria-label="Remove rule" leftIcon={<Trash2 className="size-4" aria-hidden="true" />}>Remove</Button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {isAdmin ? (
        <section>
          <h2 className="text-base font-semibold text-stone-900">Add a rule</h2>
          <form onSubmit={(e) => void submit(e)} className="mt-3 flex flex-col gap-3 rounded-xl border border-stone-200 p-4 sm:flex-row sm:flex-wrap sm:items-end">
            <label className="flex flex-col gap-1 text-sm text-stone-700">
              When the review is about
              <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ReviewRuleKind, value: '' })} className="h-9 w-52">
                {ADDABLE.map((k) => <option key={k} value={k}>{REVIEW_RULE_KIND_LABELS[k]}</option>)}
              </Select>
            </label>
            {form.kind === 'department' ? (
              <CategoryInput value={form.value} categories={categoriesQ.data ?? []} onChange={(value) => setForm({ ...form, value })} />
            ) : form.kind === 'review_kind' ? (
              <label className="flex flex-col gap-1 text-sm text-stone-700">
                Kind of review
                <Select value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} className="h-9 w-56" required>
                  <option value="">Choose…</option>
                  {Object.entries(REVIEW_KIND_LABELS).map(([k, v]) => <option key={k} value={k}>{v.title}</option>)}
                </Select>
              </label>
            ) : null}
            <label className="flex flex-col gap-1 text-sm text-stone-700">
              Goes to
              <AssigneeSelect value={form.assignee || null} people={people} label="Goes to" className="h-9 w-48" onChange={(id) => setForm({ ...form, assignee: id ?? '' })} />
            </label>
            <Button type="submit" loading={saving} disabled={!form.assignee || (needsValue && !form.value.trim())} leftIcon={<Plus className="size-4" aria-hidden="true" />}>Add rule</Button>
          </form>
        </section>
      ) : null}

      {isAdmin ? (
        <section>
          <h2 className="text-base font-semibold text-stone-900">Items already waiting</h2>
          <p className="mt-1 text-sm text-stone-600">Rules only run when an item is created. Run them now over the queue.</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variant="secondary" loading={applying} onClick={() => void applyNow()} leftIcon={<Wand2 className="size-4" aria-hidden="true" />}>Apply rules now</Button>
            <label className="flex items-center gap-2 text-sm text-stone-700"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> Also re-assign items someone already has</label>
          </div>
        </section>
      ) : null}
    </div>
  )
}

/** Type a category; Lightspeed departments and categories (subcategories too) drop down to pick from. */
function CategoryInput({ value, categories, onChange }: { value: string; categories: string[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()
  const options = categorySuggestions(value, categories)
  return (
    <label className="relative flex flex-col gap-1 text-sm text-stone-700">
      Category
      <Input role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" value={value} required placeholder="Start typing: Camping, Sunglasses…" className="h-9 w-64"
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, options.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
          else if (e.key === 'Enter' && open && options[active]) { e.preventDefault(); onChange(options[active]!); setOpen(false) }
          else if (e.key === 'Escape') setOpen(false)
        }} />
      {open && options.length ? (
        <ul id={listId} role="listbox" className="absolute top-full z-40 mt-1 max-h-72 w-72 overflow-y-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg">
          {options.map((o, i) => (
            <li key={o} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); onChange(o); setOpen(false) }}
              className={cn('cursor-pointer px-3 py-1.5 text-stone-900', i === active && 'bg-stone-100', o.includes('/') && 'pl-6 text-stone-700')}>{o}</li>
          ))}
        </ul>
      ) : null}
      <span className="text-xs text-stone-500">A top level covers its subcategories.</span>
    </label>
  )
}
