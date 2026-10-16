import { useState, type FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Pencil, Trash2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { deleteProcedure, getProcedure, saveProcedure } from '@/services/procedures'
import { ACCOUNTING_CATEGORIES, ACCOUNTING_CATEGORY_LABELS, categoryLabel } from '@/lib/accounting'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import type { AccountingCategory, AccountingProcedure } from '@/types'
import { PageHeader } from '@/components/shared/PageHeader'
import { BackLink } from '@/components/shared/BackLink'
import { Markdown } from '@/components/shared/Markdown'
import { StickySaveBar } from '@/components/shared/StickySaveBar'
import { Alert, Badge, Button, FormField, Input, Select, Spinner, Textarea } from '@/components/ui'

/** One procedure: read it as a page, or edit it (plain text with ## headings, numbered steps, **bold**). */
export default function ProcedurePage() {
  const { id = 'new' } = useParams()
  const isNew = id === 'new'
  const { organization, profile } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const editing = isNew || params.get('edit') === '1'
  const q = useSupabaseQuery(async () => (isNew ? null : getProcedure(id)), [id])

  if (!isNew && q.isLoading) return <div className="flex justify-center py-16"><Spinner label="Loading…" className="text-brand" /></div>
  if (q.error) return <Alert variant="error">{q.error}</Alert>
  if (!isNew && !q.data) return <Alert variant="error">Procedure not found.</Alert>
  if (!organization || !profile) return null
  const p = q.data ?? null

  if (editing) {
    return (
      <ProcedureForm
        key={p ? `${p.id}:${p.updated_at}` : 'new'}
        procedure={p}
        onSaved={async (savedId) => {
          if (isNew) navigate(`${ROUTES.accountingProcedures}/${savedId}`, { replace: true })
          else { const next = new URLSearchParams(params); next.delete('edit'); setParams(next, { replace: true }); await q.refetch() }
        }}
        onCancel={() => (isNew ? navigate(ROUTES.accountingProcedures) : setParams(new URLSearchParams(), { replace: true }))}
        save={(input) => saveProcedure(organization.id, isNew ? null : id, input, profile.id)}
      />
    )
  }

  async function remove() {
    if (!p || !window.confirm(`Delete "${p.title}"? Tasks that point to it keep working, without the steps.`)) return
    try {
      await deleteProcedure(p.id)
      toast.success('Deleted')
      navigate(ROUTES.accountingProcedures, { replace: true })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <BackLink fallback={ROUTES.accountingProcedures} fallbackLabel="Procedures" />
      <PageHeader eyebrow={categoryLabel(p!.category)} title={p!.title} description={p!.summary || undefined}
        actions={<div className="flex gap-2">
          <Button variant="secondary" onClick={() => setParams(new URLSearchParams({ edit: '1' }), { replace: true })} leftIcon={<Pencil className="size-4" aria-hidden="true" />}>Edit</Button>
          <Button variant="ghost" onClick={() => void remove()} className="text-red-700 hover:bg-red-50" leftIcon={<Trash2 className="size-4" aria-hidden="true" />}>Delete</Button>
        </div>} />
      <article className="rounded-2xl border border-stone-200 bg-white p-5 text-sm leading-relaxed text-stone-800 sm:p-6">
        {p!.body.trim() ? <Markdown text={p!.body} /> : <p className="text-stone-500">Nothing written yet. Click Edit.</p>}
      </article>
      <p className="mt-3 text-xs text-stone-500">Last updated {new Date(p!.updated_at).toLocaleString()}.</p>
    </div>
  )
}

function ProcedureForm({ procedure, onSaved, onCancel, save }: {
  procedure: AccountingProcedure | null
  onSaved: (id: string) => Promise<void>
  onCancel: () => void
  save: (input: { title: string; category: AccountingCategory; summary: string; body: string }) => Promise<string>
}) {
  const [title, setTitle] = useState(procedure?.title ?? '')
  const [category, setCategory] = useState<AccountingCategory>(procedure?.category ?? 'other')
  const [summary, setSummary] = useState(procedure?.summary ?? '')
  const [body, setBody] = useState(procedure?.body ?? '## When\n\n## Steps\n1. \n\n## Watch out for\n- ')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setError('Give it a title'); return }
    setSaving(true)
    setError(null)
    try {
      const id = await save({ title, category, summary, body })
      toast.success('Saved')
      await onSaved(id)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mx-auto max-w-5xl pb-24">
      <BackLink fallback={ROUTES.accountingProcedures} fallbackLabel="Procedures" />
      <PageHeader title={procedure ? 'Edit procedure' : 'New procedure'} description="Write it for someone who has never done it: when, the steps in order, who to call, what to check, what goes wrong." />
      {error ? <Alert variant="error" className="mb-4">{error}</Alert> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <FormField label="Title" htmlFor="p-title"><Input id="p-title" value={title} onChange={(e) => setTitle(e.target.value)} /></FormField>
          <FormField label="Category" htmlFor="p-category">
            <Select id="p-category" value={category} onChange={(e) => setCategory(e.target.value as AccountingCategory)}>
              {ACCOUNTING_CATEGORIES.map((c) => <option key={c} value={c}>{ACCOUNTING_CATEGORY_LABELS[c]}</option>)}
            </Select>
          </FormField>
          <FormField label="One-line summary" htmlFor="p-summary"><Input id="p-summary" value={summary} onChange={(e) => setSummary(e.target.value)} /></FormField>
          <FormField label="The procedure" htmlFor="p-body" hint="Lines starting with ## are headings, 1. 2. 3. are steps, - are bullets, **text** is bold.">
            <Textarea id="p-body" rows={22} value={body} onChange={(e) => setBody(e.target.value)} className="font-mono text-sm" />
          </FormField>
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium text-stone-800">How it reads <Badge tone="neutral">preview</Badge></p>
          <article className="rounded-2xl border border-stone-200 bg-white p-5 text-sm leading-relaxed text-stone-800">
            <h1 className="mb-3 text-lg font-semibold text-stone-900">{title || 'Title'}</h1>
            <Markdown text={body} />
          </article>
        </div>
      </div>
      <StickySaveBar saving={saving} onCancel={onCancel} label="Save procedure" error={error} />
    </form>
  )
}
