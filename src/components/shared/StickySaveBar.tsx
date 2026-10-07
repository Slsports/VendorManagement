import { Button } from '@/components/ui'
import { cn } from '@/lib/utils'

/**
 * Save / Cancel pinned to the bottom of the screen while a long form is open (Dana, Oct 8), on phones
 * as well: full-width thumb-sized buttons there. Place it as the last child of the <form>; it shows
 * "Saving…" and the save error right on the bar.
 */
export function StickySaveBar({ saving, label = 'Save changes', error, onCancel, className }: { saving: boolean; label?: string; error?: string | null; onCancel: () => void; className?: string }) {
  return (
    <div
      className={cn(
        'sticky bottom-0 z-20 -mx-4 border-t border-stone-200 bg-white/95 px-4 pt-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur sm:mx-0 sm:rounded-xl sm:border',
        'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
        className,
      )}
    >
      {error ? <p role="alert" className="mb-2 text-sm font-medium text-red-700">{error}</p> : null}
      <div className="flex items-center gap-2 sm:justify-end">
        {saving ? <span className="hidden text-sm text-stone-500 sm:inline">Saving…</span> : null}
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving} className="flex-1 sm:flex-none">Cancel</Button>
        <Button type="submit" loading={saving} className="flex-1 sm:flex-none">{saving ? 'Saving…' : label}</Button>
      </div>
    </div>
  )
}
