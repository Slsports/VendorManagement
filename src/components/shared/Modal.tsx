import type { FormEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { Button } from '@/components/ui'

/** A small pop-up form: title, fields, Cancel and one main button. Bottom sheet on phones. */
export function Modal({ title, children, submitLabel, busy, onSubmit, onClose }: {
  title: string
  children: ReactNode
  submitLabel: string
  busy?: boolean
  onSubmit: () => void | Promise<void>
  onClose: () => void
}) {
  function submit(e: FormEvent) {
    e.preventDefault()
    e.stopPropagation()
    void onSubmit()
  }
  // A portal keeps this form out of any form on the page (a pop-up from the vendor form, say).
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-stone-900/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <form onSubmit={submit} className="flex max-h-[100dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:max-h-[90vh] sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-stone-200 px-4 py-3">
          <h2 className="text-base font-semibold text-stone-900">{title}</h2>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100"><X className="size-5" aria-hidden="true" /></button>
        </div>
        <div className="space-y-3 overflow-y-auto px-4 py-3 text-sm">{children}</div>
        <div className="flex justify-end gap-2 border-t border-stone-200 px-4 py-3">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="submit" loading={busy}>{submitLabel}</Button>
        </div>
      </form>
    </div>,
    document.body,
  )
}
