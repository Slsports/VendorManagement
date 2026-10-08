/** Default tenant seeded in migration 0001 (Shaver Lake Sports Inc.). */
export const DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-000000000001'

export const USER_ROLES = ['admin', 'manager', 'buyer', 'viewer', 'uploader'] as const
export type UserRole = (typeof USER_ROLES)[number]

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrator',
  manager: 'Manager',
  buyer: 'Buyer',
  viewer: 'Viewer',
  uploader: 'Invoice uploader',
}

/** Store codes for the default tenant. Other tenants define their own in the stores table. */
export const STORE_CODES = ['SLS', 'SLH', 'SLM', 'GS'] as const

/**
 * Spreadsheet aliases that must map to a store code on import (spec §2 plus
 * docs/decisions.md). The authoritative list is stores.aliases in the database;
 * this mirror is for client-side parsing of pasted or uploaded sheets.
 */
export const STORE_CODE_ALIASES: Record<string, (typeof STORE_CODES)[number]> = {
  TOWN: 'SLS',
  MARINA: 'SLM',
  HAPPY: 'GS',
  HC: 'GS',
}

/** Order lifecycle (strategy 1C). Payment status is tracked separately (decisions log). */
export const ORDER_STATUSES = [
  'open',
  'awaiting_confirmation',
  'confirmed',
  'shipped',
  'received',
  'entered',
  'ready_to_pay',
  'paid',
  'cancelled',
] as const
export type OrderStatus = (typeof ORDER_STATUSES)[number]

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  open: 'Open',
  awaiting_confirmation: 'Awaiting confirmation',
  confirmed: 'Confirmed',
  shipped: 'Shipped',
  received: 'Received',
  entered: 'Entered',
  ready_to_pay: 'Ready to pay',
  paid: 'Paid',
  cancelled: 'Cancelled',
}

export const ROUTES = {
  login: '/login',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  dashboard: '/',
  vendors: '/vendors',
  orders: '/orders',
  purchaseOrders: '/purchase-orders',
  returns: '/returns',
  shipments: '/shipments',
  buyingShows: '/buying-shows',
  payments: '/payments',
  salesReports: '/sales-reports',
  reports: '/reports',
  vendorScores: '/reports/vendor-scores',
  productSourcing: '/product-sourcing',
  files: '/files',
  settings: '/settings',
  upload: '/upload',
  search: '/search',
  repGroups: '/rep-groups',
  lines: '/lines',
  wwdContacts: '/contacts/worldwide',
  review: '/review',
  mail: '/mail',
  mergeReport: '/review/merges',
} as const

/** localStorage keys for per-device conveniences. Never for data. */
export const STORAGE_KEYS = {
  sidebarCollapsed: 'vms.sidebar.collapsed',
} as const
