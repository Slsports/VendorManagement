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
export interface PersonRow { key: string; kind: 'vendor' | 'group'; id: string; name: string | null; email: string | null; phone: string | null; phones: ContactPhone[]; title: string | null; type: string; roles: ContactType[]; starred: boolean; learned: boolean; note: string | null; confirmedAt: string | null; badEmail: boolean }

/** The vendor's contacts plus its rep group's people, our assigned rep (starred) first. */
export function peopleFor(v: ContactsVendor): PersonRow[] {
  const own: PersonRow[] = v.vendor_emails.map((c) => ({ key: `v:${c.id}`, kind: 'vendor', id: c.id, name: c.contact_name, email: c.email, phone: c.phone, phones: phonesOf(c), title: c.title, type: (c.roles?.length ? c.roles : [c.contact_type]).map((r) => CONTACT_TYPE_LABELS[r as ContactType] ?? r).join(' · '), roles: (c.roles?.length ? c.roles : [c.contact_type]) as ContactType[], starred: v.assigned_rep_contact_id === c.id, learned: c.source === 'email_enrichment', note: c.notes, confirmedAt: c.confirmed_at, badEmail: !!c.bad_email_at }))
  const group: PersonRow[] = (v.rep_groups?.rep_group_contacts ?? []).map((c) => ({ key: `g:${c.id}`, kind: 'group', id: c.id, name: c.name, email: c.email, phone: c.phone, phones: phonesOf(c), title: c.title, type: `Rep · ${v.rep_groups!.name}`, roles: ['rep'] as ContactType[], starred: v.assigned_rep_group_contact_id === c.id, learned: false, note: c.notes, confirmedAt: null, badEmail: false }))
  return [...own, ...group].sort((a, b) => Number(b.starred) - Number(a.starred))
}

/**
 * Our main rep for the top of the vendor page: the one marked Main rep, else (when we buy through a rep group) the rep
 * group's people, else the vendor's own reps. Dana, Oct 15: "Anytime there's a rep group … that's who needs to be at the
 * top", even when the company's own people write to us; they are there for customer service, shipping or billing.
 */
export function ourReps(v: ContactsVendor): PersonRow[] {
  const people = peopleFor(v)
  const starred = people.filter((p) => p.starred)
  if (starred.length) return starred
  const group = people.filter((p) => p.kind === 'group')
  if (group.length) return group.slice(0, 2)
  return people.filter((p) => p.kind === 'vendor' && p.roles.includes('rep')).slice(0, 2)
}
