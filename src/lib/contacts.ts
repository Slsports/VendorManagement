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
export interface PersonRow { key: string; kind: 'vendor' | 'group'; id: string; name: string | null; email: string | null; phone: string | null; title: string | null; type: string; starred: boolean }

/** The vendor's contacts plus its rep group's people, our assigned rep (starred) first. */
export function peopleFor(v: ContactsVendor): PersonRow[] {
  const own: PersonRow[] = v.vendor_emails.map((c) => ({ key: `v:${c.id}`, kind: 'vendor', id: c.id, name: c.contact_name, email: c.email, phone: c.phone, title: c.title, type: CONTACT_TYPE_LABELS[c.contact_type as ContactType] ?? c.contact_type, starred: v.assigned_rep_contact_id === c.id }))
  const group: PersonRow[] = (v.rep_groups?.rep_group_contacts ?? []).map((c) => ({ key: `g:${c.id}`, kind: 'group', id: c.id, name: c.name, email: c.email, phone: c.phone, title: c.title, type: `Rep · ${v.rep_groups!.name}`, starred: v.assigned_rep_group_contact_id === c.id }))
  return [...own, ...group].sort((a, b) => Number(b.starred) - Number(a.starred))
}

