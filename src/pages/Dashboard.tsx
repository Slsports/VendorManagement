import { AlertTriangle, Banknote, CalendarClock, Inbox, ShoppingCart } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { PageHeader } from '@/components/shared/PageHeader'

const KPIS = [
  { label: 'Open orders', icon: ShoppingCart, phase: 4 },
  { label: 'Overdue orders', icon: AlertTriangle, phase: 4 },
  { label: 'Payments due', icon: Banknote, phase: 5 },
  { label: 'Future-dated orders', icon: CalendarClock, phase: 4 },
] as const

const PANELS = [
  { title: 'Review queue', phase: 3, text: 'Invoices and emails the pipeline could not match with confidence land here for a one-click decision.' },
  { title: 'Overdue and future-dated orders', phase: 4, text: 'Orders 30 days past their quoted ship date, and pre-bookings shipping more than 30 days out.' },
  { title: 'Recent activity', phase: 3, text: 'Who changed what, across vendors, orders and payments.' },
] as const

export default function DashboardPage() {
  const { profile } = useAuth()
  const first = profile?.full_name?.split(' ')[0]

  return (
    <div>
      <PageHeader
        title={first ? `Good to see you, ${first}` : 'Dashboard'}
        description="The numbers below go live as each phase lands. Navigation, roles and the shell are in place now."
      />

      <section aria-label="Key figures" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {KPIS.map(({ label, icon: Icon, phase }) => (
          <div key={label} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-stone-600">{label}</p>
              <Icon className="size-5 text-stone-400" aria-hidden="true" />
            </div>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-stone-300">—</p>
            <p className="mt-1 text-xs text-stone-400">Live in Phase {phase}</p>
          </div>
        ))}
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        {PANELS.map((p) => (
          <div key={p.title} className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-stone-900">{p.title}</h2>
            <div className="mt-4 flex items-start gap-3 rounded-xl bg-stone-50 p-4">
              <Inbox className="mt-0.5 size-5 shrink-0 text-stone-400" aria-hidden="true" />
              <div>
                <p className="text-sm text-stone-600">{p.text}</p>
                <p className="mt-1 text-xs text-stone-400">Phase {p.phase}</p>
              </div>
            </div>
          </div>
        ))}
      </section>
    </div>
  )
}
