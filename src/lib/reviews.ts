import type { ReviewRuleKind } from '@/types'

/** Titles and help for each kind of review item, in the order the queue shows them. */
export const REVIEW_KIND_LABELS: Record<string, { title: string; help: string }> = {
  vendor_merge: { title: 'Merged at import', help: 'Lightspeed had these names for what looked like one vendor. Confirm, or split a name back out.' },
  vendor_duplicate: { title: 'Possible duplicates', help: 'Two records that look alike. Keep both, or merge into the one you choose.' },
  vendor_rename: { title: 'Name clean-ups', help: 'Lightspeed names that carried a rep or parent-company tag. Edit the name if you like, then use it; the old name stays as an alias.' },
  email_sender: { title: 'Who is this mail from?', help: 'One answer per sender files all its mail, now and later. Rep groups and services that send for many vendors are filed email by email, by the vendor each one names.' },
  vendor_marker: { title: 'Lightspeed markers', help: 'Names that carried an asterisk in Lightspeed.' },
  category_change: { title: 'Category clean-up', help: 'Proposed Lightspeed category changes, by batch. Nothing changes in Lightspeed until a batch is approved.' },
}

export const REVIEW_RULE_KIND_LABELS: Record<ReviewRuleKind, string> = {
  fishing: 'Fishing vendors',
  department: 'Lightspeed department',
  vendor: 'One vendor',
  review_kind: 'Kind of review',
  fallback: 'Everything else',
}

/** Suggested priority per rule kind: the more specific, the earlier it runs. */
export const REVIEW_RULE_PRIORITY: Record<ReviewRuleKind, number> = { vendor: 10, fishing: 20, department: 30, review_kind: 40, fallback: 100 }

/** Lightspeed departments with items in the Oct 5 2026 export. Rules can name any department; these are the suggestions. */
export const LS_DEPARTMENTS = [
  'AUTOMOTIVE', 'CAMPING', 'CLOTHING', 'DRUG STORE', 'ELECTRONICS', 'FISHING', 'FOOTWEAR', 'GROCERY', 'HARDWARE',
  'HEATERS - FANS', 'HOUSEHOLD', 'KNIVES', 'MAPS & BOOKS', 'MARINE SUPPLIES', 'OUTDOOR SPORTS', 'PET ACCESSORIES',
  'SOUVENIRS', 'SUMMER ITEMS', 'SUNGLASSES & ACCESSORIES', 'TOYS & GAMES', 'WATERSPORTS', 'WINTERSPORTS',
] as const

/** One line that says what a rule matches. */
export function describeRule(rule: { match_kind: ReviewRuleKind; match_value: string | null }, vendorName?: string | null): string {
  switch (rule.match_kind) {
    case 'fishing': return 'Reviews about fishing vendors, or in the FISHING department'
    case 'department': return `Reviews in the ${rule.match_value ?? ''} department`
    case 'vendor': return `Reviews about ${vendorName ?? 'one vendor'}`
    case 'review_kind': return REVIEW_KIND_LABELS[rule.match_value ?? '']?.title ?? `Reviews of kind ${rule.match_value ?? ''}`
    case 'fallback': return 'Everything no other rule catches'
  }
}
