import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Bell, KeyRound, LogOut, Menu, Search, User } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { ROLE_LABELS, ROUTES } from '@/lib/constants'
import { cn, errorMessage, initials } from '@/lib/utils'
import { Dropdown } from '@/components/ui'
import { TopSearch } from './TopSearch'
import { ViewAsSelect } from './ViewAsBar'

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { profile, role, signOut } = useAuth()
  const navigate = useNavigate()
  const canSearch = role !== 'uploader'

  async function handleSignOut() {
    try {
      await signOut()
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-stone-200 bg-white/95 px-4 backdrop-blur sm:px-6 lg:px-8">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open menu"
        className="rounded-lg p-2 text-stone-600 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-brand md:hidden"
      >
        <Menu className="size-5" aria-hidden="true" />
      </button>

      {canSearch ? <TopSearch /> : null}

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
        <ViewAsSelect />
        {canSearch ? (
          <button
            type="button"
            onClick={() => navigate(ROUTES.search)}
            aria-label="Search"
            className="rounded-lg p-2 text-stone-600 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-brand sm:hidden"
          >
            <Search className="size-5" aria-hidden="true" />
          </button>
        ) : null}

        <Dropdown
          label="Notifications"
          trigger={({ toggle, ...aria }) => (
            <button
              type="button"
              onClick={toggle}
              {...aria}
              aria-label="Notifications"
              className="relative rounded-lg p-2 text-stone-600 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-brand"
            >
              <Bell className="size-5" aria-hidden="true" />
            </button>
          )}
          panelClassName="w-80"
        >
          <div className="px-3 py-2">
            <p className="text-sm font-semibold text-stone-900">Notifications</p>
            <p className="mt-1 text-sm text-stone-500">Nothing yet. Pipeline alerts, overdue orders and payments due will appear here.</p>
          </div>
        </Dropdown>

        <Dropdown
          label="Account menu"
          trigger={({ toggle, ...aria }) => (
            <button
              type="button"
              onClick={toggle}
              {...aria}
              aria-label="Account menu"
              className={cn(
                'flex items-center gap-2 rounded-full p-1 pr-1 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-brand sm:pr-3',
              )}
            >
              <span aria-hidden="true" className="inline-flex size-8 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                {initials(profile?.full_name || profile?.email)}
              </span>
              <span className="hidden max-w-40 truncate text-sm font-medium text-stone-800 sm:block">
                {profile?.full_name || profile?.email}
              </span>
            </button>
          )}
        >
          {(close) => (
            <div>
              <div className="px-3 py-2">
                <p className="truncate text-sm font-semibold text-stone-900">{profile?.full_name || 'Account'}</p>
                <p className="truncate text-xs text-stone-500">{profile?.email}</p>
                {role ? <p className="mt-1 text-xs font-medium text-brand">{ROLE_LABELS[role]}</p> : null}
              </div>
              <div className="my-1 border-t border-stone-100" />
              <button
                type="button"
                onClick={() => {
                  close()
                  navigate(ROUTES.settings)
                }}
                className={cn('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-stone-700 hover:bg-stone-100', role !== 'admin' && 'hidden')}
              >
                <User className="size-4" aria-hidden="true" /> Settings
              </button>
              <button
                type="button"
                onClick={() => {
                  close()
                  navigate(ROUTES.resetPassword)
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-stone-700 hover:bg-stone-100"
              >
                <KeyRound className="size-4" aria-hidden="true" /> Change password
              </button>
              <button
                type="button"
                onClick={() => {
                  close()
                  void handleSignOut()
                }}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-stone-700 hover:bg-stone-100"
              >
                <LogOut className="size-4" aria-hidden="true" /> Sign out
              </button>
            </div>
          )}
        </Dropdown>
      </div>
    </header>
  )
}
