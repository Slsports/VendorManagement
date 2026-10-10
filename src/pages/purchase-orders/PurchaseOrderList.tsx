import { PageHeader } from '@/components/shared/PageHeader'
import { ComingSoon } from '@/components/shared/ComingSoon'

export default function Page() {
  return (
    <div>
      <PageHeader title="Purchase Orders" />
      <ComingSoon phase={5}>Purchase orders created from confirmations and pushed into Lightspeed, with receiving read back automatically.</ComingSoon>
    </div>
  )
}
