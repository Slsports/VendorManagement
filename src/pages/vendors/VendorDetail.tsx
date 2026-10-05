import { useParams } from 'react-router-dom'
import { PageHeader } from '@/components/shared/PageHeader'
import { ComingSoon } from '@/components/shared/ComingSoon'

export default function VendorDetailPage() {
  const { id } = useParams()
  return (
    <div>
      <PageHeader eyebrow="Vendor" title={`Vendor ${id ?? ''}`} />
      <ComingSoon phase={4}>Overview, open-order banner, orders, sales reports, files and notes for this vendor.</ComingSoon>
    </div>
  )
}
