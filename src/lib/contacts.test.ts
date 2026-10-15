import { describe, expect, it } from 'vitest'
import { ourReps, type ContactsVendor } from './contacts'
import type { RepGroupContact, VendorEmail } from '@/types'

const person = (id: string, name: string, roles: string[]) => ({ id, contact_name: name, email: `${id}@x.com`, roles, contact_type: roles[0], source: 'email_enrichment', phones: [] }) as unknown as VendorEmail
const groupRep = { id: 'g1', name: 'Maryellen Reynolds', email: 'maryellenreps@gmail.com', phones: [] } as unknown as RepGroupContact
const planetCotton = (over: Partial<ContactsVendor> = {}): ContactsVendor => ({
  id: 'v', vendor_emails: [person('heather', 'Heather Studds', ['rep']), person('gaby', 'Gabriela', ['ap'])],
  rep_groups: { id: 'rg', name: 'Maryellen Reynolds', rep_group_contacts: [groupRep] } as unknown as ContactsVendor['rep_groups'],
  assigned_rep_contact_id: null, assigned_rep_group_contact_id: null, ...over,
})

describe('our main rep (Dana, Oct 15)', () => {
  it('is the rep group person when we buy through a rep group, even if company people are tagged rep', () => {
    expect(ourReps(planetCotton()).map((p) => p.name)).toEqual(['Maryellen Reynolds'])
  })
  it('is whoever is marked Main rep', () => {
    expect(ourReps(planetCotton({ assigned_rep_contact_id: 'gaby' })).map((p) => p.name)).toEqual(['Gabriela'])
  })
  it("is the vendor's own rep when there is no rep group", () => {
    expect(ourReps(planetCotton({ rep_groups: null })).map((p) => p.name)).toEqual(['Heather Studds'])
  })
})
