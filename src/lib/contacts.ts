import { CONTACT_TYPE_LABELS } from '@/lib/vendors'
import type { ContactType, RepGroup, RepGroupContact, VendorEmail } from '@/types'

export interface ContactsVendor {
  id: string
  vendor_emails: VendorEmail[]
  rep_groups: (RepGroup & { rep_group_contacts?: RepGroupContact[] }) | null
  assigned_rep_contact_id: string | null
  assigned_rep_group_contact_id: string | null
}

/** One person on the vendor page: the vendor's own contact, or someone at its rep group. */
export interface PersonRow { key: string; kind: 'vendor' | 'group'; id: string; name: string | null; email: string | null; phone: string | null; title: string | null; type: string; roles: ContactType[]; starred: boolean }

/** The vendor's contacts plus its rep group's people, our assigned rep (starred) first. */
export function peopleFor(v: ContactsVendor): PersonRow[] {
  const own: PersonRow[] = v.vendor_emails.map((c) => ({ key: `v:${c.id}`, kind: 'vendor', id: c.id, name: c.contact_name, email: c.email, phone: c.phone, title: c.title, type: (c.roles?.length ? c.roles : [c.contact_type]).map((r) => CONTACT_TYPE_LABELS[r as ContactType] ?? r).join(' · '), roles: (c.roles?.length ? c.roles : [c.contact_type]) as ContactType[], starred: v.assigned_rep_contact_id === c.id }))
  const group: PersonRow[] = (v.rep_groups?.rep_group_contacts ?? []).map((c) => ({ key: `g:${c.id}`, kind: 'group', id: c.id, name: c.name, email: c.email, phone: c.phone, title: c.title, type: `Rep · ${v.rep_groups!.name}`, roles: ['rep'] as ContactType[], starred: v.assigned_rep_group_contact_id === c.id }))
  return [...own, ...group].sort((a, b) => Number(b.starred) - Number(a.starred))
}

/** Our rep for the top of the vendor page (Dana, Oct 12): the starred one, else the vendor's reps, else its rep group's people. */
export function ourReps(v: ContactsVendor): PersonRow[] {
  const people = peopleFor(v)
  const starred = people.filter((p) => p.starred)
  if (starred.length) return starred
  const own = people.filter((p) => p.kind === 'vendor' && p.roles.includes('rep'))
  return (own.length ? own : people.filter((p) => p.kind === 'group')).slice(0, 2)
}
