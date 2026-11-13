import { useContext, useEffect, useState, type ReactNode } from 'react'
import toast from 'react-hot-toast'
import { Pencil } from 'lucide-react'
import { AuthContext } from '@/context/AuthContext'
import { isRecordPage, loadPageTexts, onPageTextsChanged, pageKeyFor, resetPageText, savePageText } from '@/services/pageTexts'
import { cn, errorMessage } from '@/lib/utils'

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: {
  title: string
  description?: ReactNode
  eyebrow?: string
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="min-w-0 flex-1">
        {eyebrow ? <p className="text-xs font-semibold uppercase tracking-wide text-brand">{eyebrow}</p> : null}
        <h1 className="truncate text-2xl font-semibold tracking-tight text-stone-900">{title}</h1>
        {typeof description === 'string' ? <EditableDescription text={description} /> : description ? <p className="mt-1 max-w-2xl text-sm text-stone-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  )
}

/**
 * The paragraph under the title (Dana, Nov 13: "the paragraph under the title of each page can be edited by me anytime" …
 * "I like editing it on its page so I can view what's on it as I type"). Her saved wording shows for everyone; the admin
 * sees a pencil to change it right here, or put the original back. Pages about one record (a vendor, an order) build
 * theirs from the record, so they are not edited.
 */
function EditableDescription({ text }: { text: string }) {
  const auth = useContext(AuthContext)
  const org = auth?.organization?.id ?? null
  const key = typeof window === 'undefined' ? '' : pageKeyFor(window.location.pathname, window.location.search)
  const canEdit = !!org && !!auth?.isAdmin && !!key && !isRecordPage(key)
  const [custom, setCustom] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!org || !key || isRecordPage(key)) return
    let live = true
    const read = () => { void loadPageTexts(org).then((m) => { if (live) setCustom(m.get(key) ?? null) }) }
    read()
    const off = onPageTextsChanged(read)
    return () => { live = false; off() }
  }, [org, key])

  const shown = custom ?? text
  async function save() {
    if (!org) return
    setSaving(true)
    try {
      if (draft.trim() === text.trim()) await resetPageText(org, key)
      else await savePageText(org, key, draft.trim())
      setEditing(false)
      toast.success('Saved for everyone')
    } catch (err) {
      toast.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }
  async function original() {
    if (!org) return
    setSaving(true)
    try { await resetPageText(org, key); setEditing(false); toast.success('The original wording is back') } catch (err) { toast.error(errorMessage(err)) } finally { setSaving(false) }
  }

  if (editing) {
    return (
      <div className="mt-2 max-w-3xl">
        <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.max(3, Math.ceil(draft.length / 90))} aria-label="The paragraph under the title"
          className="w-full rounded-lg border border-brand/40 bg-white px-3 py-2 text-sm text-stone-700 shadow-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" disabled={saving} onClick={() => void save()} className="inline-flex h-8 items-center rounded-lg bg-brand px-3 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-60">{saving ? 'Saving…' : 'Save'}</button>
          <button type="button" disabled={saving} onClick={() => setEditing(false)} className="inline-flex h-8 items-center rounded-lg border border-stone-300 bg-white px-3 text-sm font-medium text-stone-700 hover:bg-stone-50">Cancel</button>
          {custom !== null ? <button type="button" disabled={saving} onClick={() => void original()} className="text-sm font-medium text-brand hover:underline">Use the original</button> : null}
          <span className="text-xs text-stone-500">Everyone sees this wording once you save.</span>
        </div>
      </div>
    )
  }
  return (
    <p className="mt-1 max-w-2xl text-sm text-stone-600">
      {shown}
      {canEdit ? (
        <button type="button" onClick={() => { setDraft(shown); setEditing(true) }} title="Change this paragraph" aria-label="Change this paragraph"
          className="ml-1.5 inline-flex translate-y-0.5 rounded p-0.5 text-stone-400 hover:bg-stone-100 hover:text-brand">
          <Pencil className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </p>
  )
}
