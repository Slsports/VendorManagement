import { NavLink, Outlet } from 'react-router-dom'
import { ROUTES } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { PageHeader } from '@/components/shared/PageHeader'
import { BackLink } from '@/components/shared/BackLink'
import { SETTINGS_TABS } from './tabs'


export default function SettingsLayout() {
  return (
    <div>
      <BackLink fallback={ROUTES.dashboard} fallbackLabel="Dashboard" />
      <PageHeader title="Settings" description="Organization, stores, people, terms and integrations." />
      <nav aria-label="Settings sections" className="mb-6 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex w-max gap-1 border-b border-stone-200">
          {SETTINGS_TABS.map((t) => (
            <li key={t.slug}>
              <NavLink
                to={`${ROUTES.settings}/${t.slug}`}
                replace /* switching tabs is not a step: Back leaves Settings to where you came from */
                className={({ isActive }) =>
                  cn(
                    '-mb-px block whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium',
                    isActive ? 'border-brand text-brand' : 'border-transparent text-stone-600 hover:text-stone-900',
                  )
                }
              >
                {t.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </div>
  )
}
