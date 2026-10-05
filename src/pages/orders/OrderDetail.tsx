import { useParams } from 'react-router-dom'
import { PageHeader } from '@/components/shared/PageHeader'
import { ComingSoon } from '@/components/shared/ComingSoon'

export default function OrderDetailPage() {
  const { id } = useParams()
  return (
    <div>
      <PageHeader eyebrow="Order" title={`Order ${id ?? ''}`} />
      <ComingSoon phase={4}>Status timeline, line items, confirmation and invoice side by side, check-in, comparison results and payment history.</ComingSoon>
    </div>
  )
}
