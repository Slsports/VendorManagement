import { PageHeader } from '@/components/shared/PageHeader'
import { ComingSoon } from '@/components/shared/ComingSoon'

export default function Page() {
  return (
    <div>
      <PageHeader title="File Manager" />
      <ComingSoon phase={6}>Every document in one place: browse by vendor or order, preview PDFs and images, download, and tag.</ComingSoon>
    </div>
  )
}
