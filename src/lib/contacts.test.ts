import { describe, expect, it } from 'vitest'
import { alternateRep, formerFor, ourReps, peopleFor, portalUnconfirmed, type ContactsVendor } from './contacts'
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

describe('the five contact rules (Dana, Oct 19)', () => {
  const recent = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const old = new Date(Date.now() - 3 * 365 * 86_400_000).toISOString()
  const portal = (id: string, name: string, lastVendorMail: string | null, extra: Partial<VendorEmail> = {}) =>
    ({ ...person(id, name, ['rep']), source: 'wwd_portal', last_vendor_mail_at: lastVendorMail, ...extra }) as unknown as VendorEmail
  const wfs = (contacts: VendorEmail[]): ContactsVendor => ({ id: 'wfs', vendor_emails: contacts, rep_groups: null, assigned_rep_contact_id: null, assigned_rep_group_contact_id: null })

  it('never makes a portal-only rep the Main rep (Jeff Lipke on WFS)', () => {
    expect(ourReps(wfs([portal('jeff', 'Jeff Lipke', null)]))).toEqual([])
  })
  it('counts a portal rep we emailed about the vendor in the last 24 months, not one from three years ago', () => {
    const people = peopleFor(wfs([portal('old', 'Old Rep', old), portal('new', 'New Rep', recent)]))
    expect(people.find((p) => p.id === 'old')?.portalUnconfirmed).toBe(true)
    expect(people.find((p) => p.id === 'new')?.portalUnconfirmed).toBe(false)
    expect(ourReps(wfs([portal('old', 'Old Rep', old), portal('new', 'New Rep', recent)])).map((p) => p.name)).toEqual(['New Rep'])
  })
  it('counts one Dana kept or the vendor confirmed on its form', () => {
    expect(portalUnconfirmed({ source: 'wwd_portal', kept_at: recent, confirmed_at: null, last_vendor_mail_at: null })).toBe(false)
    expect(portalUnconfirmed({ source: 'wwd_portal', confirmed_at: recent, last_vendor_mail_at: null })).toBe(false)
    expect(portalUnconfirmed({ source: 'manual', confirmed_at: null, last_vendor_mail_at: null })).toBe(false)
  })
  it('puts the rep we wrote with most recently first', () => {
    const v = wfs([{ ...person('a', 'Ann', ['rep']), last_vendor_mail_at: old } as unknown as VendorEmail, { ...person('b', 'Bob', ['rep']), last_vendor_mail_at: recent } as unknown as VendorEmail])
    expect(ourReps(v).map((p) => p.name)).toEqual(['Bob', 'Ann'])
  })
  it('keeps former contacts apart: not in the list, never Main rep', () => {
    const v = wfs([{ ...person('gone', 'Gone Rep', ['rep']), former_at: recent } as unknown as VendorEmail, person('now', 'Now Rep', ['rep'])])
    expect(peopleFor(v).map((p) => p.name)).toEqual(['Now Rep'])
    expect(formerFor(v).map((p) => p.name)).toEqual(['Gone Rep'])
    expect(ourReps(v).map((p) => p.name)).toEqual(['Now Rep'])
  })
})

describe('our alternate rep (Dana, Nov 5: Tim Parratto for Smith)', () => {
  const tim = { id: 'g2', name: 'Tim Parratto', email: 'tim@careyonsports.com', phones: [] } as unknown as RepGroupContact
  const shannon = { id: 'g1', name: 'Shannon Carey Parratto', email: 'shannon@careyonsports.com', phones: [] } as unknown as RepGroupContact
  const smith = (over: Partial<ContactsVendor> = {}): ContactsVendor => ({
    id: 'smith', vendor_emails: [person('jon', 'Jon Finger', ['rep'])],
    rep_groups: { id: 'cos', name: 'Carey On Sports', rep_group_contacts: [shannon, tim] } as unknown as ContactsVendor['rep_groups'],
    assigned_rep_contact_id: null, assigned_rep_group_contact_id: 'g1', alternate_rep_group_contact_id: 'g2', ...over,
  })
  it('shows the main rep and the alternate apart', () => {
    expect(ourReps(smith()).map((p) => p.name)).toEqual(['Shannon Carey Parratto'])
    expect(alternateRep(smith())?.name).toBe('Tim Parratto')
  })
  it('never counts the alternate as a main rep when no main rep is picked', () => {
    expect(ourReps(smith({ assigned_rep_group_contact_id: null })).map((p) => p.name)).toEqual(['Shannon Carey Parratto'])
  })
  it('has no alternate when none is picked, or when the alternate is the main rep', () => {
    expect(alternateRep(smith({ alternate_rep_group_contact_id: null }))).toBeUndefined()
    expect(alternateRep(smith({ assigned_rep_group_contact_id: 'g2' }))).toBeUndefined()
  })
  it('never makes a former contact the alternate', () => {
    const gone = { ...tim, former_at: new Date().toISOString() } as unknown as RepGroupContact
    expect(alternateRep(smith({ rep_groups: { id: 'cos', name: 'Carey On Sports', rep_group_contacts: [shannon, gone] } as unknown as ContactsVendor['rep_groups'] }))).toBeUndefined()
  })
})
