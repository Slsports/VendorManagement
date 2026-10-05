import { PageHeader } from '@/components/shared/PageHeader'
import { ComingSoon } from '@/components/shared/ComingSoon'

export default function Page() {
  return (
    <div>
      <PageHeader title="Buying Shows" />
      <ComingSoon phase={5}>Show planning: vendors to visit with booth numbers, prep checklists, budgets, pre-show report runs and the mobile confirmation scan.</ComingSoon>
    </div>
  )
}
