import { PageHeader } from '@/components/shared/PageHeader'
import { ComingSoon } from '@/components/shared/ComingSoon'

export default function Page() {
  return (
    <div>
      <PageHeader title="Upload invoice" />
      <ComingSoon phase={3}>Scan or upload a paper invoice from your phone. It goes straight to the review queue with your name and store on it.</ComingSoon>
    </div>
  )
}
