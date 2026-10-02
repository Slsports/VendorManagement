/** Default tenant seeded in migration 0001 (Shaver Lake Sports Inc.). */
export const DEFAULT_ORGANIZATION_ID = '00000000-0000-0000-0000-000000000001'

export const USER_ROLES = ['admin', 'manager', 'buyer', 'viewer'] as const
export type UserRole = (typeof USER_ROLES)[number]

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrator',
  manager: 'Manager',
  buyer: 'Buyer',
  viewer: 'Viewer',
}

/** Store codes for the default tenant. Other tenants define their own in the stores table. */
export const STORE_CODES = ['SLS', 'SLH', 'SLM', 'GS'] as const

/** Spreadsheet aliases that must map to a store code on import (spec §2). */
export const STORE_CODE_ALIASES: Record<string, (typeof STORE_CODES)[number]> = {
  HAPPY: 'GS',
  HC: 'GS',
}

export const ROUTES = {
  login: '/login',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  dashboard: '/',
} as const
