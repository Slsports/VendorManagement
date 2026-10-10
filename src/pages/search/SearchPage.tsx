import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/shared/PageHeader'
import { ComingSoon } from '@/components/shared/ComingSoon'

export default function SearchPage() {
  const [params] = useSearchParams()
  const q = params.get('q')?.trim() ?? ''
  return (
    <div>
      <PageHeader title={q ? `Results for “${q}”` : 'Search'} description="Global search across vendors, orders, invoices and files." />
      <ComingSoon phase={4}>Search lights up once vendors and orders are in the system.</ComingSoon>
    </div>
  )
}
