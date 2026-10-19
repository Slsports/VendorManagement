import { CONTACT_TYPE_LABELS } from '@/lib/vendors'
import { phonesOf, type ContactPhone } from '@/lib/phones'
import type { ContactType, RepGroup, RepGroupContact, VendorEmail } from '@/types'

export interface ContactsVendor {
  id: string
  vendor_emails: VendorEmail[]
  rep_groups: (RepGroup & { rep_group_contacts?: RepGroupContact[] }) | null
  assigned_rep_contact_id: string | null
  assigned_rep_group_contact_id: string | null
}

/** One person on the vendor page: the vendor's own contact, or someone at its rep group. */
export interface PersonRow {
  key: string; kind: 'vendor' | 'group'; id: string; name: string | null; email: string | null; phone: string | null; phones: ContactPhone[]; title: string | null; type: string; roles: ContactType[]; starred: boolean; learned: boolean; note: string | null; confirmedAt: string | null; badEmail: boolean
  /** From the WWD portal and not backed by our mail about this vendor in 24 months, a vendor form or Dana's Keep (Dana, Oct 19) */
  portalUnconfirmed: boolean
  /** No longer there: kept on file, folded, for searching old mail (Dana, Oct 19) */
  formerAt: string | null
  firstMailAt: string | null; lastMailAt: string | null; lastVendorMailAt: string | null
}

const TWO_YEARS_MS = 2 * 365.25 * 86_400_000

/** A portal contact our own mail has not backed up in 24 months (the five contact rules, Dana Oct 19). */
export function portalUnconfirmed(c: { source: string; former_at?: string | null; kept_at?: string | null; confirmed_at: string | null; last_vendor_mail_at?: string | null }, now = Date.now()): boolean {
  if (c.source !== 'wwd_portal' || c.former_at || c.kept_at || c.confirmed_at) return false
  return !c.last_vendor_mail_at || now - new Date(c.last_vendor_mail_at).getTime() > TWO_YEARS_MS
}
const fromPortal = (notes: string | null) => !!notes && notes.startsWith('From the Worldwide portal')

function allPeople(v: ContactsVendor): PersonRow[] {
  const own: PersonRow[] = v.vendor_emails.map((c) => ({ key: `v:${c.id}`, kind: 'vendor', id: c.id, name: c.contact_name, email: c.email, phone: c.phone, phones: phonesOf(c), title: c.title, type: (c.roles?.length ? c.roles : [c.contact_type]).map((r) => CONTACT_TYPE_LABELS[r as ContactType] ?? r).join(' · '), roles: (c.roles?.length ? c.roles : [c.contact_type]) as ContactType[], starred: v.assigned_rep_contact_id === c.id, learned: c.source === 'email_enrichment', note: c.notes, confirmedAt: c.confirmed_at, badEmail: !!c.bad_email_at,
    portalUnconfirmed: portalUnconfirmed(c), formerAt: c.former_at ?? null, firstMailAt: c.first_mail_at ?? null, lastMailAt: c.last_mail_at ?? null, lastVendorMailAt: c.last_vendor_mail_at ?? null }))
  const group: PersonRow[] = (v.rep_groups?.rep_group_contacts ?? []).map((c) => ({ key: `g:${c.id}`, kind: 'group', id: c.id, name: c.name, email: c.email, phone: c.phone, phones: phonesOf(c), title: c.title, type: `Rep · ${v.rep_groups!.name}`, roles: ['rep'] as ContactType[], starred: v.assigned_rep_group_contact_id === c.id, learned: false, note: c.notes, confirmedAt: null, badEmail: false,
    // a rep group person read from the portal counts once we have mail with them in 24 months (any vendor of the group)
    portalUnconfirmed: !c.former_at && fromPortal(c.notes) && (!c.last_mail_at || Date.now() - new Date(c.last_mail_at).getTime() > TWO_YEARS_MS),
    formerAt: c.former_at ?? null, firstMailAt: c.first_mail_at ?? null, lastMailAt: c.last_mail_at ?? null, lastVendorMailAt: c.last_mail_at ?? null }))
  return [...own, ...group]
}

/** The vendor's current contacts plus its rep group's people, our assigned rep (starred) first. Former contacts are left out. */
export function peopleFor(v: ContactsVendor): PersonRow[] {
  return allPeople(v).filter((p) => !p.formerAt).sort((a, b) => Number(b.starred) - Number(a.starred))
}

/** People no longer there (Dana, Oct 19), most recently marked first: kept so old mail can be found by name. */
export function formerFor(v: ContactsVendor): PersonRow[] {
  return allPeople(v).filter((p) => p.formerAt).sort((a, b) => b.formerAt!.localeCompare(a.formerAt!))
}

/**
 * Our main rep for the top of the vendor page: the one marked Main rep, else (when we buy through a rep group) the rep
 * group's people, else the vendor's own reps, most recent mail first. People only the WWD portal names, not backed by our
 * mail in 24 months, and former contacts never count (the five contact rules, Dana Oct 19). Dana, Oct 15: "Anytime there's a rep group … that's who needs to be at the
 * top", even when the company's own people write to us; they are there for customer service, shipping or billing.
 */
export function ourReps(v: ContactsVendor): PersonRow[] {
  const people = peopleFor(v)
  const starred = people.filter((p) => p.starred)
  if (starred.length) return starred
  // never someone only the WWD portal names (Dana, Oct 19: Jeff Lipke showed as WFS's Main rep from WWD's old page)
  const group = people.filter((p) => p.kind === 'group' && !p.portalUnconfirmed)
  if (group.length) return group.slice(0, 2)
  // the vendor's own reps, the one we wrote with most recently about this vendor first
  return people.filter((p) => p.kind === 'vendor' && p.roles.includes('rep') && !p.portalUnconfirmed)
    .sort((a, b) => (b.lastVendorMailAt ?? '').localeCompare(a.lastVendorMailAt ?? '')).slice(0, 2)
}
