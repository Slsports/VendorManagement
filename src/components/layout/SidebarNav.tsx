import { useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { navForRole, type NavItem } from '@/lib/navigation'
import { ROLE_LABELS } from '@/lib/constants'
import { cn, initials } from '@/lib/utils'
import { BrandMark } from './BrandMark'

export interface SidebarNavProps {
  /** Show labels (expanded) or icons only (rail). */
  expanded: boolean
  /** Called after a link is chosen (closes the mobile drawer). */
  onNavigate?: () => void
  /** Desktop collapse toggle in the footer. */
  collapseToggle?: { collapsed: boolean; onToggle: () => void }
}

export function SidebarNav({ expanded, onNavigate, collapseToggle }: SidebarNavProps) {
  const { branding, profile, role } = useAuth()
  const groups = navForRole(role)

  return (
    <div className="flex h-full flex-col text-white">
      <div className={cn('flex h-16 shrink-0 items-center gap-3 px-3', expanded ? 'pr-4' : 'justify-center')}>
        <BrandMark branding={branding} size="sm" className="shrink-0" />
        {expanded ? (
          <div className="min-w-0">
            <p className="line-clamp-2 text-sm font-semibold leading-tight">{branding.appName}</p>
            {branding.appName.toLowerCase().includes(branding.organizationName.toLowerCase()) ? null : (
              <p className="truncate text-xs text-white/60">{branding.organizationName}</p>
            )}
          </div>
        ) : null}
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-2 pb-4">
        {groups.map((group) => (
          <div key={group.label} className="mt-4 first:mt-1">
            {expanded ? (
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-white/40">{group.label}</p>
            ) : (
              <div className="mx-3 mb-2 border-t border-white/10 first:hidden" aria-hidden="true" />
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <NavEntry key={item.to} item={item} expanded={expanded} onNavigate={onNavigate} />
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className={cn('shrink-0 border-t border-white/10 p-2', expanded ? '' : 'flex flex-col items-center')}>
        <div className={cn('flex items-center gap-3 rounded-lg px-2 py-2', !expanded && 'justify-center px-0')}>
          <span
            aria-hidden="true"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-white/15 text-xs font-semibold"
          >
            {initials(profile?.full_name || profile?.email)}
          </span>
          {expanded ? (
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{profile?.full_name || profile?.email}</p>
              <p className="truncate text-xs text-white/60">{role ? ROLE_LABELS[role] : ''}</p>
            </div>
          ) : null}
        </div>
        {collapseToggle ? (
          <button
            type="button"
            onClick={collapseToggle.onToggle}
            aria-label={collapseToggle.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/60 hover:bg-white/10 hover:text-white',
              !expanded && 'justify-center px-0',
            )}
          >
            {collapseToggle.collapsed ? <PanelLeftOpen className="size-4" aria-hidden="true" /> : <PanelLeftClose className="size-4" aria-hidden="true" />}
            {expanded ? <span>Collapse</span> : null}
          </button>
        ) : null}
      </div>
    </div>
  )
}

function NavEntry({ item, expanded, onNavigate }: { item: NavItem; expanded: boolean; onNavigate?: () => void }) {
  const location = useLocation()
  const Icon = item.icon
  const inSection = location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
  // Open while inside the section; a manual toggle applies until inSection changes.
  const [toggle, setToggle] = useState<{ inSection: boolean; open: boolean } | null>(null)
  const open = toggle && toggle.inSection === inSection ? toggle.open : inSection
  const setOpen = (fn: (prev: boolean) => boolean) => setToggle({ inSection, open: fn(open) })

  const linkClasses = (active: boolean) =>
    cn(
      'group/link flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
      active ? 'bg-white/15 text-white' : 'text-white/75 hover:bg-white/10 hover:text-white',
      !expanded && 'justify-center px-0',
    )

  if (!item.children || !expanded) {
    return (
      <li>
        <NavLink
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          title={expanded ? undefined : item.label}
          className={({ isActive }) => linkClasses(isActive)}
        >
          <Icon className="size-5 shrink-0" aria-hidden="true" />
          {expanded ? <span className="truncate">{item.label}</span> : <span className="sr-only">{item.label}</span>}
        </NavLink>
      </li>
    )
  }

  const current = `${location.pathname}${location.search}`
  return (
    <li>
      <div className={cn('flex items-center rounded-lg', inSection ? 'bg-white/15 text-white' : 'text-white/75 hover:bg-white/10 hover:text-white')}>
        <NavLink to={item.to} end onClick={onNavigate} className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 rounded-lg">
          <Icon className="size-5 shrink-0" aria-hidden="true" />
          <span className="truncate">{item.label}</span>
        </NavLink>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? `Collapse ${item.label}` : `Expand ${item.label}`}
          className="mr-1 rounded-md p-1.5 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <ChevronDown className={cn('size-4 transition-transform', open ? 'rotate-180' : '')} aria-hidden="true" />
        </button>
      </div>
      {open ? (
        <ul className="mt-0.5 space-y-0.5 border-l border-white/10 pl-3 ml-5">
          {item.children.map((child) => {
            const active = current === child.to || (child.to === item.to && current === item.to)
            return (
              <li key={child.to}>
                {/* Plain Link: NavLink would mark every status link active since they share a pathname. */}
                <Link
                  to={child.to}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'block truncate rounded-md px-3 py-1.5 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
                    active ? 'bg-white/15 text-white' : 'text-white/65 hover:bg-white/10 hover:text-white',
                  )}
                >
                  {child.label}
                </Link>
              </li>
            )
          })}
        </ul>
      ) : null}
    </li>
  )
}
