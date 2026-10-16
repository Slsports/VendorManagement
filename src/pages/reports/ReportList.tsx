import { Link } from 'react-router-dom'
import { Award, ChartColumn } from 'lucide-react'
import { ROUTES } from '@/lib/constants'
import { PageHeader } from '@/components/shared/PageHeader'
import { ComingSoon } from '@/components/shared/ComingSoon'

export default function Page() {
  return (
    <div>
      <PageHeader title="Reports" />
      <ul className="mb-6 grid gap-3 sm:grid-cols-2">
        <li>
          <Link to={ROUTES.salesReports} className="flex items-start gap-3 rounded-2xl border border-stone-200 bg-white p-4 hover:border-brand">
            <ChartColumn className="mt-0.5 size-5 text-brand" aria-hidden="true" />
            <span><span className="block font-medium text-stone-900">Sales reports</span><span className="block text-sm text-stone-600">Vendor and category reports straight from Lightspeed, by the sales report spec: stores together or apart, any period, filed and saved.</span></span>
          </Link>
        </li>
        <li>
          <Link to={ROUTES.vendorScores} className="flex items-start gap-3 rounded-2xl border border-stone-200 bg-white p-4 hover:border-brand">
            <Award className="mt-0.5 size-5 text-brand" aria-hidden="true" />
            <span><span className="block font-medium text-stone-900">Vendor scores</span><span className="block text-sm text-stone-600">Ease, communication, on-time fulfilment, accuracy, shipping and issue resolution, from the order history and staff ratings.</span></span>
          </Link>
        </li>
      </ul>
      <ComingSoon phase={6}>Spending, order status, payments, buying show ROI and cost trends, with date and store filters and CSV export.</ComingSoon>
    </div>
  )
}
