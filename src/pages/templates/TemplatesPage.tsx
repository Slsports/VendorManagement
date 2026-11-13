import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Eye, FileText, Pencil } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listTemplates, saveTemplate } from '@/services/templates'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { StickySaveBar } from '@/components/shared/StickySaveBar'
import { FreightEmailPreview } from '@/components/templates/FreightEmailPreview'
import { Alert, Button, FormField, Input, Spinner, Textarea } from '@/components/ui'
import type { MessageTemplate } from '@/types'

/**
 * Documents & email templates (Dana, Nov 13: "anytime we have an email draft or letter that sends to vendors I want them in
 * one place where I can edit any time I want … categorize the emails and docs so I can see what they say and immediately
 * edit them"). Each template shows its wording; Edit changes it for every email VMS writes from then on.
 */
export default function TemplatesPage() {
  const { organization, role } = useAuth()
  const canEdit = role === 'admin' || role === 'manager' || role === 'buyer'
  const q = useSupabaseQuery(async () => (organization ? listTemplates(organization.id) : []), [organization?.id])
  const [editing, setEditing] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ subject: string; body: string } | null>(null)
  const groups = new Map<string, MessageTemplate[]>()
  for (const t of q.data ?? []) groups.set(t.category, [...(groups.get(t.category) ?? []), t])
  if (!groups.has('Freight')) groups.set('Freight', [])

  return (
    <div className="mx-auto max-w-4xl pb-16">
      <PageHeader title="Templates" description="The letters and emails VMS writes to vendors. Read what they say and change the wording any time; new emails use it from then on." />
      {q.isLoading ? <div className="flex justify-center py-12"><Spinner label="Loading…" className="text-brand" /></div> : q.error ? <Alert variant="error">{q.error}</Alert> : null}

      {[...groups.entries()].map(([category, list]) => (
        <section key={category} className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">{category}</h2>
          <div className="space-y-3">
            {category === 'Freight' ? (
              <article className="rounded-2xl border border-stone-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold text-stone-900">Freight routing letter (PDF)</h3>
                    <p className="text-sm text-stone-600">Attached to every freight email, with that order's form link printed in it.</p>
                  </div>
                  <Link to={ROUTES.routingLetter} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-stone-300 bg-white px-3 text-sm font-medium text-stone-800 hover:bg-stone-50"><FileText className="size-4" aria-hidden="true" />Open and edit the letter</Link>
                </div>
              </article>
            ) : null}
            {list.map((t) => editing === t.key && organization
              ? <TemplateEditor key={t.key} organizationId={organization.id} t={t} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await q.refetch() }} />
              : (
                <article key={t.key} className="rounded-2xl border border-stone-200 bg-white p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-stone-900">{t.title}</h3>
                      {t.description ? <p className="text-sm text-stone-600">{t.description}</p> : null}
                    </div>
                    <div className="flex gap-2">
                      {t.key === 'freight_email' ? <Button size="sm" variant="secondary" onClick={() => setPreview({ subject: t.subject, body: t.body })} leftIcon={<Eye className="size-4" aria-hidden="true" />}>Preview</Button> : null}
                      {canEdit ? <Button size="sm" variant="secondary" onClick={() => setEditing(t.key)} leftIcon={<Pencil className="size-4" aria-hidden="true" />}>Edit</Button> : null}
                    </div>
                  </div>
                  {t.subject ? <p className="mt-3 text-sm"><span className="text-stone-500">Subject: </span><span className="font-medium text-stone-900">{t.subject}</span></p> : null}
                  <pre className="mt-2 max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg bg-stone-50 p-3 font-sans text-sm text-stone-800">{t.body}</pre>
                  <p className="mt-2 text-xs text-stone-500">Last changed {new Date(t.updated_at).toLocaleDateString()}</p>
                </article>
              ))}
          </div>
        </section>
      ))}
      {preview ? <FreightEmailPreview subject={preview.subject} body={preview.body} onClose={() => setPreview(null)} /> : null}
      <p className="text-sm text-stone-500">More emails move here one group at a time: orders (the no-reply follow-up, PO requests, the reorder email), vendors (the contact confirmation) and credits.</p>
    </div>
  )
}

function TemplateEditor({ organizationId, t, onClose, onSaved }: { organizationId: string; t: MessageTemplate; onClose: () => void; onSaved: () => Promise<void> }) {
  const [subject, setSubject] = useState(t.subject)
  const [body, setBody] = useState(t.body)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState(false)
  async function save(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await saveTemplate(organizationId, t.key, subject, body)
      toast.success(`${t.title} saved`)
      await onSaved()
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }
  return (
    <form onSubmit={(e) => void save(e)} className="rounded-2xl border border-brand/30 bg-white p-4">
      <h3 className="font-semibold text-stone-900">{t.title}</h3>
      {t.description ? <p className="text-sm text-stone-600">{t.description}</p> : null}
      <p className="mt-2 rounded-lg bg-stone-50 p-2 text-xs text-stone-600">Keep the words in curly brackets, like <strong>{'{po}'}</strong>: VMS fills them in for each email. Put two stars around words for bold: <strong>**like this**</strong>. A link: <strong>[Click Here]({'{form_link}'})</strong>.</p>
      <FormField label="Subject" htmlFor={`tpl-subj-${t.key}`} className="mt-3"><Input id={`tpl-subj-${t.key}`} value={subject} onChange={(e) => setSubject(e.target.value)} /></FormField>
      <FormField label="Email" htmlFor={`tpl-body-${t.key}`} className="mt-3"><Textarea id={`tpl-body-${t.key}`} rows={22} value={body} onChange={(e) => setBody(e.target.value)} /></FormField>
      {t.key === 'freight_email' ? <Button type="button" size="sm" variant="secondary" className="mt-2" onClick={() => setPreview(true)} leftIcon={<Eye className="size-4" aria-hidden="true" />}>Preview (before saving)</Button> : null}
      {preview ? <FreightEmailPreview subject={subject} body={body} onClose={() => setPreview(false)} /> : null}
      <StickySaveBar className="mt-3" saving={saving} error={error} label="Save" onCancel={onClose} />
    </form>
  )
}
