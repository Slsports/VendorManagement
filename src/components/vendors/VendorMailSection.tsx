import { PenLine } from 'lucide-react'
import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { listVendorThreads } from '@/services/mail'
import { ThreadTable } from '@/components/mail/ThreadTable'
import { Button } from '@/components/ui'

/** Every conversation with this vendor, newest first, whoever owns it. */
export function VendorMailSection({ vendorId, organizationId, onNewEmail }: { vendorId: string; organizationId: string; onNewEmail?: () => void }) {
  const q = useSupabaseQuery(() => listVendorThreads(organizationId, vendorId), [organizationId, vendorId])
  const rows = q.data ?? []
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 lg:col-span-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Mail</h2>
        <div className="flex items-center gap-3">
          {rows.length >= 50 ? <span className="text-xs text-stone-500">Showing the newest 50</span> : null}
          {onNewEmail ? <Button size="sm" onClick={onNewEmail} leftIcon={<PenLine className="size-4" aria-hidden="true" />}>New email</Button> : null}
        </div>
      </div>
      {q.isLoading ? <p className="mt-3 text-sm text-stone-500">Loading mail…</p>
        : q.error ? <p className="mt-3 text-sm text-red-700">{q.error}</p>
        : rows.length === 0 ? <p className="mt-3 text-sm text-stone-500">No mail filed to this vendor yet. Mail from orders@ lands here once the sender is known.</p>
        : <div className="mt-3"><ThreadTable rows={rows} showVendor={false} sortParam="mail_sort" /></div>}
    </section>
  )
}
