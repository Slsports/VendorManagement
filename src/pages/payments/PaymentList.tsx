import { PageHeader } from '@/components/shared/PageHeader'
import { ComingSoon } from '@/components/shared/ComingSoon'

export default function Page() {
  return (
    <div>
      <PageHeader title="Payments" />
      <ComingSoon phase={5}>Upload the Worldwide payment sheet or the Bill.com payments report and the matching orders are marked paid. Remittance sheets for delivery vendors are generated here.</ComingSoon>
    </div>
  )
}
