import { PageHeader } from '@/components/shared/PageHeader'
import { ComingSoon } from '@/components/shared/ComingSoon'

export default function Page() {
  return (
    <div>
      <PageHeader title="Vendors" />
      <ComingSoon phase={3}>The vendor list arrives with the spreadsheet import: contacts, rep groups, channels you buy through, payment terms, open orders and sales reports on every vendor page.</ComingSoon>
    </div>
  )
}
