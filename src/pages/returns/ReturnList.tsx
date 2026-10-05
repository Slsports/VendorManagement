import { PageHeader } from '@/components/shared/PageHeader'
import { ComingSoon } from '@/components/shared/ComingSoon'

export default function Page() {
  return (
    <div>
      <PageHeader title="Returns & Credits" />
      <ComingSoon phase={5}>Returns, credits, defectives and warranties with RMA tracking, generated from check-in discrepancies and emailed to the rep.</ComingSoon>
    </div>
  )
}
