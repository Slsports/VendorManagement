import type { ReviewRuleKind } from '@/types'

/** Titles and help for each kind of review item, in the order the queue shows them. */
export const REVIEW_KIND_LABELS: Record<string, { title: string; help: string }> = {
  vendor_merge: { title: 'Merged at import', help: 'Lightspeed had these names for what looked like one vendor. Confirm, or split a name back out.' },
  vendor_duplicate: { title: 'Possible duplicates', help: 'Two records that look alike. Keep both, or merge into the one you choose.' },
  vendor_rename: { title: 'Name clean-ups', help: 'Lightspeed names that carried a rep or parent-company tag. Edit the name if you like, then use it; the old name stays as an alias.' },
  email_sender: { title: 'Who is this mail from?', help: 'One answer per sender files all its mail, now and later. Rep groups and services that send for many vendors are filed email by email, by the vendor each one names.' },
  vendor_assignment: { title: 'Who orders from these vendors?', help: 'Trevor ran their sales reports before the show, so they went to Jarrett. Keep Jarrett, or pick who orders from the vendor.' },
  vendor_marker: { title: 'Lightspeed markers', help: 'Names that carried an asterisk in Lightspeed.' },
  art_approval: { title: 'Artwork to approve?', help: 'Claude was not sure whether the vendor is waiting on us to approve artwork, a proof or a design. Yes puts it on the Artwork approvals card.' },
  booth_rep: { title: 'Booth-mates', help: 'At a Worldwide show this vendor shared a booth with lines of one rep group. Same booth is generally the same rep group.' },
  show_line: { title: 'Show list and portal lines', help: 'A brand on a Worldwide show list or in the Worldwide portal that may be one of our vendors under another name. Yes puts the show, booth and portal details on the vendor\'s page.' },
  item_change: { title: 'Unavailable items', help: 'The vendor says these are discontinued, replaced or out of stock. Pick what to do; VMS writes it to Lightspeed with a dated note.' },
  portal_contact: { title: 'WWD portal contacts to check', help: 'People the Worldwide portal lists for a vendor that we have not emailed about that vendor in 24 months. Keep them, mark them no longer their rep (kept under Former contacts so their old mail can be found), or delete a mistake. Your answers are the list of outdated portal info for the show.' },
  portal_conflict: { title: 'Worldwide portal differences', help: 'The Worldwide portal says something different from what VMS has for a vendor. Keep ours, or use the portal\'s.' },
  rep_line: { title: 'Rep group lines', help: 'A rep\'s emails name a line that is with another rep group, or a brand that is not one of our vendors yet. Lines with no rep group are added on their own.' },
  vendor_form: { title: 'From vendor forms', help: 'A vendor wrote on our contact form that they also represent companies VMS does not have. Add them as vendors or lines, then mark it handled.' },
  invoice_upload: { title: 'Scanned invoices to file', help: 'Invoices someone uploaded that Claude could not file by itself: the vendor, the store or the paper was unclear. Pick what is missing and click File it. A store you pick is remembered for that vendor.' },
  category_change: { title: 'Category clean-up', help: 'Proposed Lightspeed category changes, by batch. Nothing changes in Lightspeed until a batch is approved.' },
}

export const REVIEW_RULE_KIND_LABELS: Record<ReviewRuleKind, string> = {
  fishing: 'Fishing vendors',
  department: 'Lightspeed category',
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
    case 'department': return `${rule.match_value ?? ''}${(rule.match_value ?? '').includes('/') ? '' : ' and its subcategories'}`
    case 'vendor': return `Reviews about ${vendorName ?? 'one vendor'}`
    case 'review_kind': return REVIEW_KIND_LABELS[rule.match_value ?? '']?.title ?? `Reviews of kind ${rule.match_value ?? ''}`
    case 'fallback': return 'Everything no other rule catches'
  }
}

/**
 * Suggestions for a category rule as you type: Lightspeed departments and the categories on file, top
 * levels and subcategories ("Camping", "Camping/Coolers"). Starts-with first, then contains; one entry
 * per name whatever its case.
 */
export function categorySuggestions(typed: string, categories: string[], max = 12): string[] {
  const q = typed.trim().toLowerCase()
  const seen = new Set<string>()
  const all = [...LS_DEPARTMENTS, ...categories].filter((n) => { const k = n.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
  if (!q) return all.slice(0, max)
  const rank = (n: string) => { const l = n.toLowerCase(); return l.startsWith(q) ? 0 : l.split(/[/\s&-]+/).some((w) => w.startsWith(q)) ? 1 : 2 }
  return all.filter((n) => n.toLowerCase().includes(q)).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).slice(0, max)
}

/**
 * The Review card and the Review queue tabs (Dana, Oct 12): one place for everything waiting on a decision.
 * Paperwork tabs list Claude's order checks (each opens its check page); the rest list review items by kind.
 * "Never bought from" is only on the Review queue page, not a dashboard count.
 */
export type ReviewTab = 'confirmations' | 'invoices' | 'items' | 'hand' | 'answer' | 'who' | 'vendor' | 'freight' | 'never'
export const REVIEW_TABS: { id: ReviewTab; label: string; help: string }[] = [
  { id: 'confirmations', label: 'Confirmations', help: 'Vendor confirmations Claude checked against our order. Open one to look it over.' },
  { id: 'invoices', label: 'Invoices', help: 'Invoices Claude checked against the confirmation. Open one to look it over.' },
  { id: 'items', label: 'Unavailable items', help: 'Items a vendor confirmation says are discontinued, replaced or out of stock. Your choice is written to Lightspeed.' },
  { id: 'hand', label: 'Needs a hand', help: 'Paperwork Claude could not read, or could not match to an order.' },
  { id: 'answer', label: 'Needs an answer?', help: 'Claude is not sure these need an answer from us.' },
  { id: 'who', label: 'Who is this?', help: 'Senders Claude could not place. One answer files all their mail.' },
  { id: 'vendor', label: 'Vendor changes', help: 'Possible duplicates, name and category clean-ups, Lightspeed markers.' },
  { id: 'freight', label: 'Freight', help: 'Delivery receipts and freight Claude could not match to a vendor.' },
  { id: 'never', label: 'Never bought from', help: 'Companies Claude thinks we have never bought from. Their mail goes to Promotions. If one is a vendor under another name, click This is… and pick it.' },
]

/** Which tab a review item kind belongs to. */
export function reviewTabOfKind(kind: string): ReviewTab {
  switch (kind) {
    case 'mail_reply': case 'art_approval': return 'answer'
    case 'email_sender': return 'who'
    case 'delivery_receipt': case 'freight_card': return 'freight'
    case 'item_change': return 'items'
    case 'invoice_upload': return 'hand'
    default: return 'vendor'
  }
}

/** Which tab an open order check belongs to. */
export function reviewTabOfCheck(c: { kind: 'confirmation' | 'invoice'; status: string }): ReviewTab {
  if (c.status !== 'to_review') return 'hand'
  return c.kind === 'confirmation' ? 'confirmations' : 'invoices'
}
