/** Default tenant seeded in migration 0001 (Shaver Lake Sports Inc.). */
export const DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-000000000001'

export const USER_ROLES = ['admin', 'manager', 'buyer', 'viewer', 'uploader'] as const
export type UserRole = (typeof USER_ROLES)[number]

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrator',
  manager: 'Manager',
  buyer: 'Buyer',
  viewer: 'Viewer',
  uploader: 'Invoice Uploads',
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
  documentImport: '/vendors/import-documents',
  orders: '/orders',
  orderChecks: '/orders/paperwork',
  purchaseOrders: '/purchase-orders',
  returns: '/returns',
  shipments: '/shipments',
  freight: '/freight',
  freightCarriers: '/freight/carriers',
  freightQuotes: '/freight/quotes',
  routingLetter: '/freight/routing-letter',
  routingReceipt: '/r',
  vendorConfirm: '/confirm',
  contactConfirmations: '/vendors/confirmations',
  buyingShows: '/buying-shows',
  payments: '/payments',
  salesReports: '/sales-reports',
  inventoryCounts: '/inventory-counts',
  itemNames: '/item-names',
  reports: '/reports',
  vendorScores: '/reports/vendor-scores',
  poUse: '/reports/po-use',
  productSourcing: '/product-sourcing',
  files: '/files',
  settings: '/settings',
  lightspeedSettings: '/settings/lightspeed',
  billcomSettings: '/settings/billcom',
  lightspeedCallback: '/integrations/lightspeed/callback',
  upload: '/upload',
  search: '/search',
  repGroups: '/rep-groups',
  lines: '/lines',
  wwdContacts: '/contacts/worldwide',
  review: '/review',
  mail: '/mail',
  workingOrders: '/mail/working',
  mailWith: '/mail/with',
  team: '/team',
  tasks: '/tasks',
  supplies: '/supplies',
  notifications: '/notifications',
  accounting: '/accounting',
  accountingMail: '/accounting/mail',
  accountingContacts: '/accounting/contacts',
  accountingTasks: '/accounting/tasks',
  accountingCalendar: '/accounting/calendar',
  accountingProcedures: '/accounting/procedures',
  accountingInsurance: '/accounting/insurance',
  accountingContracts: '/accounting/contracts',
  accountingDocuments: '/accounting/documents',
  lsPos: '/ls-pos',
  help: '/help',
  mergeReport: '/review/merges',
} as const

/** localStorage keys for per-device conveniences. Never for data. */
export const STORAGE_KEYS = {
  sidebarCollapsed: 'vms.sidebar.collapsed',
  viewAs: 'vms.viewAs',
} as const
