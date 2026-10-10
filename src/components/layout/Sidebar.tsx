import { useState } from 'react'
import { cn } from '@/lib/utils'
import { SidebarNav } from './SidebarNav'

/**
 * Desktop/tablet sidebar.
 * - rail=false: fixed 256px, always expanded (lg and up, not collapsed).
 * - rail=true: 64px icon rail that expands to 256px on hover, overlaying content
 *   (md, or lg when the user collapsed it).
 */
export function Sidebar({
  rail,
  collapseToggle,
}: {
  rail: boolean
  collapseToggle?: { collapsed: boolean; onToggle: () => void }
}) {
  const [hovered, setHovered] = useState(false)
  const expanded = !rail || hovered

  return (
    <aside
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHovered(false)
      }}
      className={cn(
        'fixed inset-y-0 left-0 z-30 hidden bg-sidebar shadow-xl transition-[width] duration-200 ease-out md:block',
        expanded ? 'w-64' : 'w-16',
      )}
      aria-label="Sidebar"
    >
      <SidebarNav expanded={expanded} collapseToggle={collapseToggle} />
    </aside>
  )
}
