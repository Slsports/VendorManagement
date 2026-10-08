import { useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Plus, Tag, X } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listThreadTags, tagEmailVendor } from '@/services/mail'
import { ROUTES } from '@/lib/constants'
import { errorMessage } from '@/lib/utils'
import { VendorPicker } from '@/components/vendors/VendorPicker'
import { Button } from '@/components/ui'

/**
 * The other vendors a conversation is about (a Worldwide pallet email names five). Each sees it under its
 * Mail. Tagged by the vendors the mail names, by Claude reading it, or by hand ("Also tag a vendor").
 */
export function ThreadVendorTags({ threadId, emailId, filedVendorId, canEdit }: { threadId: string; emailId: string; filedVendorId: string | null; canEdit: boolean }) {
  const q = useSupabaseQuery(() => listThreadTags(threadId), [threadId])
  const [adding, setAdding] = useState(false)
  const tags = (q.data ?? []).filter((t) => t.vendor_id !== filedVendorId)

  async function run(label: string, fn: () => Promise<void>) {
    try {
      await fn()
      toast.success(label)
      await q.refetch()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  if (!tags.length && !canEdit) return null
  return (
    <section className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm" aria-label="Also about these vendors">
      <span className="inline-flex items-center gap-1 text-stone-500"><Tag className="size-4" aria-hidden="true" /> Also about</span>
      {tags.length === 0 ? <span className="text-stone-400">no other vendors</span> : tags.map((t) => (
        <span key={t.vendor_id} className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 text-stone-800">
          <Link to={`${ROUTES.vendors}/${t.vendor_id}`} className="hover:text-brand hover:underline">{t.name}</Link>
          {canEdit ? <button type="button" aria-label={`Untag ${t.name}`} onClick={() => void run(`Untagged ${t.name}`, () => tagEmailVendor(t.email_id, t.vendor_id, false))} className="rounded-full p-0.5 text-stone-400 hover:bg-stone-200 hover:text-red-600"><X className="size-3.5" aria-hidden="true" /></button> : null}
        </span>
      ))}
      {canEdit ? (adding ? (
        <span className="flex items-center gap-2">
          <VendorPicker autoFocus className="w-60" placeholder="Which vendor?" onPick={(v) => { setAdding(false); return run(`Tagged ${v.name}`, () => tagEmailVendor(emailId, v.id, true)) }} />
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
        </span>
      ) : <Button size="sm" variant="ghost" onClick={() => setAdding(true)} leftIcon={<Plus className="size-4" aria-hidden="true" />}>Also tag a vendor</Button>) : null}
    </section>
  )
}
