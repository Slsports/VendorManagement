import { PageHeader } from '@/components/shared/PageHeader'
import { ComingSoon } from '@/components/shared/ComingSoon'

export default function Page() {
  return (
    <div>
      <PageHeader title="Product Sourcing" />
      <ComingSoon phase={6}>A research table for items you are looking to source: product, candidate vendors, estimated cost and status.</ComingSoon>
    </div>
  )
}
