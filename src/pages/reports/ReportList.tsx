import { PageHeader } from '@/components/shared/PageHeader'
import { ComingSoon } from '@/components/shared/ComingSoon'

export default function Page() {
  return (
    <div>
      <PageHeader title="Reports" />
      <ComingSoon phase={6}>Spending, order status, vendor performance, payments, buying show ROI and cost trends, with date and store filters and CSV export.</ComingSoon>
    </div>
  )
}
