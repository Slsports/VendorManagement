import { PageHeader } from '@/components/shared/PageHeader'
import { ComingSoon } from '@/components/shared/ComingSoon'

export default function Page() {
  return (
    <div>
      <PageHeader title="Sales Reports" />
      <ComingSoon phase={4}>Vendor and category reports from Lightspeed data: quick run with standard settings, custom date ranges, and season-over-season comparisons.</ComingSoon>
    </div>
  )
}
