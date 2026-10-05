import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Bell, LogOut, Menu, Search, User } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { ROLE_LABELS, ROUTES } from '@/lib/constants'
import { cn, errorMessage, initials } from '@/lib/utils'
import { Dropdown } from '@/components/ui'

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { profile, role, signOut } = useAuth()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const canSearch = role !== 'uploader'

  function submitSearch(e: FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    navigate(`${ROUTES.search}?q=${encodeURIComponent(q)}`)
  }

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

      {canSearch ? (
        <form onSubmit={submitSearch} role="search" className="relative hidden min-w-0 flex-1 sm:block sm:max-w-xl">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-stone-400" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search vendors, orders, invoices…"
            aria-label="Search"
            className="h-10 w-full rounded-lg border border-stone-200 bg-stone-50 pl-9 pr-3 text-sm text-stone-900 placeholder:text-stone-400 focus:border-brand focus:bg-white focus:outline-none focus:ring-2 focus:ring-ring-brand"
          />
        </form>
      ) : null}

      <div className="ml-auto flex items-center gap-1 sm:gap-2">
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
