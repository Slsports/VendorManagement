import { useSupabaseQuery } from '@/hooks/useSupabaseQuery'
import { vendorPoUse } from '@/services/wwd'
import { Badge } from '@/components/ui'

/** "Uses our PO: 3 of 11 invoices" on the vendor page, when some of its WWD invoices did not (Dana, Oct 21). */
export function VendorPoUseBadge({ vendorId }: { vendorId: string }) {
  const q = useSupabaseQuery(() => vendorPoUse(vendorId), [vendorId])
  const u = q.data
  if (!u || !u.invoices) return null
  const good = u.ours + u.written_differently
  if (good === u.invoices) return null
  return <Badge tone="warning">Uses our PO: {good} of {u.invoices} WWD invoices</Badge>
}
