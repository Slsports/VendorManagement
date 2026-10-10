import { Suspense, useCallback, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { useMediaQuery, BREAKPOINTS } from '@/hooks/useMediaQuery'
import { useStoredState } from '@/hooks/useStoredState'
import { STORAGE_KEYS } from '@/lib/constants'
import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui'
import { Sidebar } from './Sidebar'
import { SidebarNav } from './SidebarNav'
import { MobileDrawer } from './MobileDrawer'
import { Topbar } from './Topbar'
import { ViewAsBanner } from './ViewAsBar'
import { ViewAsProvider } from '@/context/ViewAsProvider'

/**
 * Responsive application frame (strategy Phase 2, without the store selector):
 * - lg and up: fixed 256px sidebar, collapsible to a 64px rail by the user
 * - md: 64px icon rail that expands on hover
 * - below md: no sidebar; hamburger opens a slide-over drawer
 */
export function AppShell() {
  const isDesktop = useMediaQuery(BREAKPOINTS.lg)
  const [collapsed, setCollapsed] = useStoredState<boolean>(STORAGE_KEYS.sidebarCollapsed, false)
  // The drawer remembers the location it was opened at, so any navigation
  // (link click, back button) closes it without an effect.
  const [drawerOpenedAt, setDrawerOpenedAt] = useState<string | null>(null)
  const location = useLocation()
  const drawerOpen = drawerOpenedAt !== null && drawerOpenedAt === location.key

  const rail = !isDesktop || collapsed
  const closeDrawer = useCallback(() => setDrawerOpenedAt(null), [])

  return (
    <ViewAsProvider>
    <div className="min-h-screen bg-surface">
      <Sidebar
        rail={rail}
        collapseToggle={isDesktop ? { collapsed, onToggle: () => setCollapsed((c) => !c) } : undefined}
      />
      <MobileDrawer open={drawerOpen} onClose={closeDrawer} title="Navigation">
        <SidebarNav expanded onNavigate={closeDrawer} />
      </MobileDrawer>

      <div className={cn('flex min-h-screen flex-col transition-[padding] duration-200', rail ? 'md:pl-16' : 'md:pl-64')}>
        <Topbar onOpenMenu={() => setDrawerOpenedAt(location.key)} />
        <ViewAsBanner />
        <main id="main" className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-7xl">
            <Suspense
              fallback={
                <div className="flex justify-center py-20">
                  <Spinner label="Loading…" className="text-brand" />
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
    </ViewAsProvider>
  )
}
