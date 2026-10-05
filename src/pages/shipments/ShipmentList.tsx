import { PageHeader } from '@/components/shared/PageHeader'
import { ComingSoon } from '@/components/shared/ComingSoon'

export default function Page() {
  return (
    <div>
      <PageHeader title="Incoming Shipments" />
      <ComingSoon phase={5}>Everything confirmed or shipped and due to arrive, on a calendar and in a table, searchable by date range.</ComingSoon>
    </div>
  )
}
