import type { LucideIcon } from 'lucide-react'
import {
  Banknote,
  Building2,
  CalendarDays,
  ChartColumn,
  ClipboardCheck,
  ClipboardList,
  FileText,
  FolderOpen,
  LayoutDashboard,
  Lightbulb,
  Mail,
  Settings,
  ShoppingCart,
  Tags,
  Users,
  Truck,
  Undo2,
  Upload,
} from 'lucide-react'
import { ORDER_STATUSES, ORDER_STATUS_LABELS, ROUTES, type UserRole } from './constants'

export interface NavChild {
  label: string
  to: string
}

export interface NavItem {
  label: string
  to: string
  icon: LucideIcon
  /** Roles that may see this item. Omitted = every role except uploader. */
  roles?: readonly UserRole[]
  /** Match only the exact path for the active state (used for "/"). */
  end?: boolean
  children?: readonly NavChild[]
  /** Show a live count beside the label. */
  badge?: 'mail'
}

export interface NavGroup {
  label: string
  items: readonly NavItem[]
}

const ORDER_CHILDREN: readonly NavChild[] = [
  { label: 'All orders', to: ROUTES.orders },
  ...ORDER_STATUSES.map((s) => ({ label: ORDER_STATUS_LABELS[s], to: `${ROUTES.orders}?status=${s}` })),
]

/** Main navigation per strategy Phase 2, adjusted by docs/decisions.md (no store selector). */
export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'Overview',
    items: [
      { label: 'Dashboard', to: ROUTES.dashboard, icon: LayoutDashboard, end: true },
      { label: 'Mail', to: ROUTES.mail, icon: Mail, badge: 'mail' },
      { label: 'Review queue', to: ROUTES.review, icon: ClipboardCheck, roles: ['admin', 'manager', 'buyer'] },
    ],
  },
  {
    label: 'Procurement',
    items: [
      { label: 'Vendors', to: ROUTES.vendors, icon: Building2 },
      { label: 'Rep groups', to: ROUTES.repGroups, icon: Users },
      { label: 'Lines', to: ROUTES.lines, icon: Tags },
      { label: 'Orders', to: ROUTES.orders, icon: ShoppingCart, children: ORDER_CHILDREN },
      { label: 'Purchase Orders', to: ROUTES.purchaseOrders, icon: ClipboardList },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Returns & Credits', to: ROUTES.returns, icon: Undo2 },
      { label: 'Incoming Shipments', to: ROUTES.shipments, icon: Truck },
      { label: 'Buying Shows', to: ROUTES.buyingShows, icon: CalendarDays },
      { label: 'Payments', to: ROUTES.payments, icon: Banknote, roles: ['admin', 'manager'] },
    ],
  },
  {
    label: 'Insights',
    items: [
      { label: 'Sales Reports', to: ROUTES.salesReports, icon: ChartColumn },
      { label: 'Reports', to: ROUTES.reports, icon: FileText },
      { label: 'Product Sourcing', to: ROUTES.productSourcing, icon: Lightbulb },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'File Manager', to: ROUTES.files, icon: FolderOpen },
      { label: 'Settings', to: ROUTES.settings, icon: Settings, roles: ['admin'] },
    ],
  },
]

/** Uploaders see one thing. */
export const UPLOADER_NAV: readonly NavGroup[] = [
  {
    label: 'Invoices',
    items: [{ label: 'Upload invoice', to: ROUTES.upload, icon: Upload, roles: ['uploader'] }],
  },
]

export function navForRole(role: UserRole | null | undefined): NavGroup[] {
  if (!role) return []
  if (role === 'uploader') return [...UPLOADER_NAV]
  return NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => !item.roles || item.roles.includes(role)),
  })).filter((group) => group.items.length > 0)
}

/** Where a signed-in user lands after login. */
export function homeRouteForRole(role: UserRole | null | undefined): string {
  return role === 'uploader' ? ROUTES.upload : ROUTES.dashboard
}
