import type { AccountingCategory } from '@/types'

/** Dana's buckets for who she deals with in billing@ (Oct 16). The contact's category sorts its mail and, later, its files. */
export const ACCOUNTING_CATEGORIES: readonly AccountingCategory[] = ['taxes', 'insurance', 'banking', 'payroll', 'donations', 'contracts', 'accounting_firm', 'bills', 'other']

export const ACCOUNTING_CATEGORY_LABELS: Record<AccountingCategory, string> = {
  taxes: 'Taxes',
  insurance: 'Insurance',
  banking: 'Banking',
  payroll: 'Payroll',
  donations: 'Donations',
  contracts: 'Contracts',
  accounting_firm: 'Accounting firm',
  bills: 'Bills',
  other: 'Other',
}

export function categoryLabel(c: string | null | undefined): string {
  return c && c in ACCOUNTING_CATEGORY_LABELS ? ACCOUNTING_CATEGORY_LABELS[c as AccountingCategory] : 'Other'
}

/** "MBS Accountancy · Lisa Larsen", or whichever half exists. */
export function contactName(c: { company: string; person: string } | null | undefined): string {
  if (!c) return ''
  return [c.company, c.person].filter(Boolean).join(' · ') || '(no name yet)'
}
