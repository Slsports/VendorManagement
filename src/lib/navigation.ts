import type { LucideIcon } from 'lucide-react'
import { Banknote, Building2, Calculator, CalendarDays, ChartColumn, CircleHelp, ClipboardCheck, ClipboardList, Contact, FileText, FolderOpen, LayoutDashboard, Lightbulb, ListTodo, Mail, Package, Receipt, Settings, ShoppingCart, SpellCheck, Tags, Truck, Undo2, Upload, Users, UsersRound } from 'lucide-react'
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
  /** Only people with this tick on their profile see the item (Accounting, Dana Oct 16). */
  flag?: 'sees_accounting'
}

export type NavFlags = { sees_accounting?: boolean } | null | undefined

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
      { label: 'Tasks', to: ROUTES.tasks, icon: ListTodo },
      { label: 'Review queue', to: ROUTES.review, icon: ClipboardCheck, roles: ['admin', 'manager', 'buyer'] },
      { label: 'Team', to: ROUTES.team, icon: UsersRound, roles: ['admin'] },
    ],
  },
  {
    label: 'Procurement',
    items: [
      { label: 'Vendors', to: ROUTES.vendors, icon: Building2 },
      { label: 'Rep groups', to: ROUTES.repGroups, icon: Users },
      { label: 'Lines', to: ROUTES.lines, icon: Tags },
      { label: 'WWD contacts', to: ROUTES.wwdContacts, icon: Contact },
      { label: 'Orders', to: ROUTES.orders, icon: ShoppingCart, children: ORDER_CHILDREN },
      { label: 'Purchase Orders', to: ROUTES.purchaseOrders, icon: ClipboardList },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Returns & Credits', to: ROUTES.returns, icon: Undo2 },
      { label: 'Incoming Shipments', to: ROUTES.shipments, icon: Truck },
      { label: 'Freight', to: ROUTES.freight, icon: Receipt },
      { label: 'Supplies', to: ROUTES.supplies, icon: Package },
      // scan or upload paper invoices (Dana, Oct 20)
      { label: 'Invoice Uploads', to: ROUTES.upload, icon: Upload, roles: ['admin', 'manager', 'buyer'] },
      { label: 'Item names', to: ROUTES.itemNames, icon: SpellCheck, roles: ['admin', 'manager', 'buyer'] },
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
    label: 'Accounting',
    items: [
      { label: 'Accounting', to: ROUTES.accounting, icon: Calculator, flag: 'sees_accounting', children: [
        { label: 'Overview', to: ROUTES.accounting },
        { label: 'Tasks', to: ROUTES.accountingTasks },
        { label: 'Calendar', to: ROUTES.accountingCalendar },
        { label: 'Mail', to: ROUTES.accountingMail },
        { label: 'Documents', to: ROUTES.accountingDocuments },
        { label: 'Contacts', to: ROUTES.accountingContacts },
        { label: 'Insurance', to: ROUTES.accountingInsurance },
        { label: 'Contracts', to: ROUTES.accountingContracts },
        { label: 'Procedures', to: ROUTES.accountingProcedures },
      ] },
    ],
  },
  {
    label: 'System',
    items: [
      { label: 'File Manager', to: ROUTES.files, icon: FolderOpen },
      { label: 'Settings', to: ROUTES.settings, icon: Settings, roles: ['admin'] },
      { label: 'Help', to: ROUTES.help, icon: CircleHelp, roles: ['admin', 'manager', 'buyer', 'viewer', 'uploader'] },
    ],
  },
]

/** Uploaders see one thing. */
export const UPLOADER_NAV: readonly NavGroup[] = [
  {
    label: 'Invoices',
    items: [{ label: 'Invoice Uploads', to: ROUTES.upload, icon: Upload, roles: ['uploader'] }],
  },
]

export function navForRole(role: UserRole | null | undefined, flags?: NavFlags): NavGroup[] {
  if (!role) return []
  if (role === 'uploader') return [...UPLOADER_NAV]
  return NAV_GROUPS.map((group) => ({
    label: group.label,
    items: group.items.filter((item) => (!item.roles || item.roles.includes(role)) && (!item.flag || !!flags?.[item.flag])),
  })).filter((group) => group.items.length > 0)
}

/** Where a signed-in user lands after login. */
export function homeRouteForRole(role: UserRole | null | undefined): string {
  return role === 'uploader' ? ROUTES.upload : ROUTES.dashboard
}
