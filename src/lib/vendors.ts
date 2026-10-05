import type { BillingRoute, OrderingFrequency, OrderWindowKind, ContactType } from '@/types'

export const BILLING_ROUTE_LABELS: Record<BillingRoute, string> = {
  worldwide: 'Worldwide',
  faire: 'Faire',
  direct: 'Direct',
}

export const BILLING_ROUTE_HELP: Record<BillingRoute, string> = {
  worldwide: 'Billed and paid through the Worldwide Distributors portal',
  faire: 'Ordered on Faire, paid by credit card',
  direct: 'Bills SLSI directly, paid through Bill.com',
}

export const BILLING_ROUTE_TONE: Record<BillingRoute, 'brand' | 'info' | 'warning'> = {
  worldwide: 'brand',
  faire: 'info',
  direct: 'warning',
}

export const ORDERING_FREQUENCY_LABELS: Record<OrderingFrequency, string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  seasonal: 'Seasonal',
  annual: 'Annual',
  as_needed: 'As needed',
}

export const ORDER_WINDOW_KIND_LABELS: Record<OrderWindowKind, string> = {
  feb_show: 'February show',
  aug_show: 'August show',
  pre_season: 'Pre-season',
  reorder: 'Reorder',
  delivery: 'Delivery route',
  custom: 'Custom',
}

export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  rep: 'Rep',
  ap: 'Accounts payable',
  customer_service: 'Customer service',
  shipping: 'Shipping',
  orders: 'Orders',
  other: 'Other',
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

export function monthsLabel(months: number[]) {
  return months
    .slice()
    .sort((a, b) => a - b)
    .map((m) => MONTHS[m - 1])
    .join(', ')
}
