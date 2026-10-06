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
  feb_show: 'Spring show (Feb)',
  aug_show: 'Fall show (Aug/Sept)',
  pre_season: 'Pre-season',
  reorder: 'Reorder',
  delivery: 'Delivery route',
  custom: 'Custom',
}

/** Contact "Title" choices, in display order. */
export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  rep: 'Rep',
  orders: 'Orders',
  ap: 'AR / Accounting',
  customer_service: 'Customer service',
  shipping: 'Warehouse / Shipping',
  owner: 'Owner',
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

export const LINK_KIND_LABELS: Record<import('@/types').VendorLinkKind, string> = {
  catalog: 'Catalog',
  price_list: 'Price list',
  order_form: 'Order form',
  specials: 'Show specials',
  website: 'Website',
  other: 'Other',
  invoice: 'Invoice',
  confirmation: 'Order confirmation',
  order: 'Order',
  packing_slip: 'Packing slip',
  payment: 'Payment',
}

export const ORDER_SEASON_LABELS: Record<import('@/types').OrderSeason, string> = { summer: 'Summer', winter: 'Winter' }
export const PAID_VIA_LABELS: Record<NonNullable<import('@/types').Order['paid_via']>, string> = { billcom: 'Bill.com', wwd: 'Worldwide portal', card: 'Credit card', other: 'Other' }

export function showLabel(code: string | null | undefined): string | null {
  if (!code) return null
  const m = code.match(/^wwd_(spring|fall)_(\d{4})$/)
  return m ? `${m[1] === 'spring' ? 'Spring' : 'Fall'} show ${m[2]}` : code
}

export function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return ''
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}


export const FREE_SHIPPING_POLICY_LABELS: Record<import('@/types').FreeShippingPolicy, string> = {
  never: 'Never free shipping',
  sometimes: 'Sometimes (show special or above a volume)',
  always: 'Always free shipping',
}
export const FREE_SHIPPING_BASIS_LABELS: Record<import('@/types').FreeShippingBasis, string> = {
  show_special: 'Show special',
  minimum_met: 'Hit their free-shipping volume',
  negotiated: 'Negotiated for this order',
  always: 'Vendor always ships free',
  other: 'Other (see note)',
}
/** One line that states a vendor's usual shipping rule. */
export function freeShippingRule(v: { free_shipping_policy: import('@/types').FreeShippingPolicy | null; free_shipping_threshold: number | null; freight_program: string | null }): string | null {
  const t = v.free_shipping_threshold !== null ? money(v.free_shipping_threshold) : null
  switch (v.free_shipping_policy) {
    case 'never': return 'Never offers free shipping'
    case 'always': return t ? `Always free shipping over ${t}` : 'Always free shipping'
    case 'sometimes': return t ? `Free shipping over ${t}, or as a show special` : 'Free shipping only as a show special or above their volume'
    default: return v.freight_program ?? null
  }
}
