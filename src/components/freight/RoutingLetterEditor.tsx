import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { ArrowDown, ArrowUp, Eye, Plus, Trash2 } from 'lucide-react'
import { useDocumentViewer } from '@/hooks/useDocumentViewer'
import { DEFAULT_LETTER, letterContentOf, routingLetterFileName, type RoutingLetterContent } from '@/lib/routingLetterPdf'
import { DEFAULT_ROUTING_EMAIL, routingLetterPdfBlob, saveWrittenLetter } from '@/services/routingLetter'
import { errorMessage } from '@/lib/utils'
import { StickySaveBar } from '@/components/shared/StickySaveBar'
import { Button, FormField, Input, Textarea } from '@/components/ui'
import type { RoutingLetter } from '@/types'

/**
 * Edit the routing letter in VMS (Dana, Nov 12: "Can it be somewhere in vms where I can edit it anytime?"). It starts from
 * the newest version's words (or the new letter), and Save makes the next version: VMS draws the PDF the vendors get.
 */
export function RoutingLetterEditor({ organizationId, current, onClose, onSaved }: { organizationId: string; current: RoutingLetter | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [c, setC] = useState<RoutingLetterContent>(() => letterContentOf(current?.content) ?? DEFAULT_LETTER)
  const [effective, setEffective] = useState(new Date().toISOString().slice(0, 10))
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { view, viewer } = useDocumentViewer()
  const next = (current?.version ?? 0) + 1

  const set = (patch: Partial<RoutingLetterContent>) => setC((x) => ({ ...x, ...patch }))
  const setSection = (i: number, patch: Partial<RoutingLetterContent['sections'][number]>) =>
    setC((x) => ({ ...x, sections: x.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) }))
  const move = (i: number, by: -1 | 1) => setC((x) => {
    const s = [...x.sections]
    const j = i + by
    if (j < 0 || j >= s.length) return x
    ;[s[i], s[j]] = [s[j], s[i]]
    return { ...x, sections: s }
  })

  async function save(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await saveWrittenLetter(organizationId, next, c, {
        effective: effective || null, note,
        subject: current?.email_subject ?? 'Updated freight routing instructions – Shaver Lake Sports', body: current?.email_body ?? DEFAULT_ROUTING_EMAIL,
      })
      toast.success(`Version ${next} saved`)
      await onSaved()
    } catch (err) {
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(e) => void save(e)} className="mb-4 rounded-2xl border border-brand/30 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">Edit the letter</h2>
          <p className="mt-1 text-sm text-stone-600">Saving makes version {next}. VMS makes the PDF; earlier versions are kept.</p>
        </div>
        <Button type="button" variant="secondary" leftIcon={<Eye className="size-4" aria-hidden="true" />}
          onClick={() => view({ name: routingLetterFileName(next), mime: 'application/pdf', load: () => routingLetterPdfBlob(c) })}>Preview the PDF</Button>
      </div>
      <p className="mt-3 rounded-lg bg-stone-50 p-2 text-xs text-stone-600">
        Writing tips: start a line with <strong>- </strong> for a bullet. Put two stars around words for bold: <strong>**like this**</strong>. A link: <strong>[words people see](https://…)</strong>. A blank line starts a new paragraph.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <FormField label="Title" htmlFor="rle-title"><Input id="rle-title" value={c.title} onChange={(e) => set({ title: e.target.value })} /></FormField>
        <FormField label="Line under the title" htmlFor="rle-sub"><Input id="rle-sub" value={c.subtitle} onChange={(e) => set({ subtitle: e.target.value })} /></FormField>
      </div>
      <FormField label="Shaded box at the top" htmlFor="rle-intro" className="mt-3"><Textarea id="rle-intro" rows={3} value={c.intro} onChange={(e) => set({ intro: e.target.value })} /></FormField>

      <h3 className="mt-5 text-sm font-semibold text-stone-900">Sections</h3>
      <ul className="mt-2 space-y-3">
        {c.sections.map((s, i) => (
          <li key={i} className="rounded-xl border border-stone-200 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <FormField label="Heading" htmlFor={`rle-h-${i}`} className="min-w-0 flex-1"><Input id={`rle-h-${i}`} value={s.heading} onChange={(e) => setSection(i, { heading: e.target.value })} /></FormField>
              <div className="flex gap-1">
                <Button type="button" size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" aria-hidden="true" /></Button>
                <Button type="button" size="sm" variant="ghost" aria-label="Move down" disabled={i === c.sections.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" aria-hidden="true" /></Button>
                <Button type="button" size="sm" variant="ghost" aria-label="Remove this section" onClick={() => { if (window.confirm(`Remove "${s.heading || 'this section'}"?`)) setC((x) => ({ ...x, sections: x.sections.filter((_, j) => j !== i) })) }}><Trash2 className="size-4" aria-hidden="true" /></Button>
              </div>
            </div>
            <FormField label="Text" htmlFor={`rle-b-${i}`} className="mt-2"><Textarea id={`rle-b-${i}`} rows={Math.min(14, Math.max(3, s.body.split('\n').length + 1))} value={s.body} onChange={(e) => setSection(i, { body: e.target.value })} /></FormField>
          </li>
        ))}
      </ul>
      <Button type="button" variant="secondary" size="sm" className="mt-2" leftIcon={<Plus className="size-4" aria-hidden="true" />}
        onClick={() => setC((x) => ({ ...x, sections: [...x.sections, { heading: '', body: '' }] }))}>Add a section</Button>

      <FormField label="Closing line" htmlFor="rle-close" className="mt-4"><Input id="rle-close" value={c.closing} onChange={(e) => set({ closing: e.target.value })} /></FormField>
      <FormField label="Footer (bottom of every page)" htmlFor="rle-foot" className="mt-3"><Input id="rle-foot" value={c.footer} onChange={(e) => set({ footer: e.target.value })} /></FormField>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <FormField label="Effective date" htmlFor="rle-eff"><Input id="rle-eff" type="date" value={effective} onChange={(e) => setEffective(e.target.value)} /></FormField>
        <FormField label="What changed (optional)" htmlFor="rle-note"><Input id="rle-note" value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
      </div>

      <StickySaveBar className="mt-4" saving={saving} error={error} label={`Save as version ${next}`} onCancel={onClose} />
      {viewer}
    </form>
  )
}
