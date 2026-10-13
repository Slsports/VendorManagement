/**
 * Phone numbers on a contact (Dana, Oct 13): several per person, each Work, Cell, Fax or Other with a typed label
 * ("if you pick other you are able to type in what it is"). Stored as vendor_emails.phones / rep_group_contacts.phones.
 */
export type PhoneType = 'work' | 'cell' | 'fax' | 'other'
export interface ContactPhone { number: string; type: PhoneType; label?: string | null; ext?: string | null }

export const PHONE_TYPE_LABELS: Record<PhoneType, string> = { work: 'Work', cell: 'Cell', fax: 'Fax', other: 'Other' }

/** "Cell", "Work", or the typed label for Other ("Warehouse"). */
export function phoneTypeLabel(p: ContactPhone): string {
  return p.type === 'other' ? (p.label?.trim() || 'Other') : PHONE_TYPE_LABELS[p.type] ?? 'Phone'
}

/** The number with its extension, as shown. */
export function phoneText(p: ContactPhone): string {
  return p.ext?.trim() ? `${p.number} ext. ${p.ext.trim()}` : p.number
}

/** tel: link (digits and a leading +; the extension after a pause). */
export function telHref(p: ContactPhone): string {
  const digits = p.number.replace(/[^\d+]/g, '')
  return `tel:${digits}${p.ext?.trim() ? `,${p.ext.replace(/\D/g, '')}` : ''}`
}

/** A contact's numbers: the list when there is one, else the old single phone field as one Work number. */
export function phonesOf(c: { phones?: ContactPhone[] | null; phone?: string | null }): ContactPhone[] {
  if (c.phones?.length) return c.phones
  return c.phone?.trim() ? [{ number: c.phone.trim(), type: 'work' }] : []
}

/** Rows as typed in the form: blank numbers dropped, labels only on Other. */
export function cleanPhones(list: ContactPhone[]): ContactPhone[] {
  return list
    .map((p) => ({ number: p.number.trim(), type: p.type, ...(p.type === 'other' && p.label?.trim() ? { label: p.label.trim() } : {}), ...(p.ext?.trim() ? { ext: p.ext.trim() } : {}) }))
    .filter((p) => p.number)
}
