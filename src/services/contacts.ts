import { supabase } from '@/lib/supabase'

export interface AddressBookEntry { email: string; name: string; where: string }

/**
 * People you can add to an email by typing a name or where they work: WWD contacts, rep group reps and
 * vendor contacts. Loaded once per page visit.
 */
let cached: { org: string; p: Promise<AddressBookEntry[]> } | null = null
export function listAddressBook(organizationId: string): Promise<AddressBookEntry[]> {
  if (cached?.org === organizationId) return cached.p
  const p = (async () => {
    const { data, error } = await supabase
      .from('partner_contacts')
      .select('name, email, department, partners(name)')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .not('email', 'is', null)
    if (error) throw error
    return (data ?? []).map((c) => ({
      email: c.email!,
      name: c.name,
      where: [(c.partners as { name: string } | null)?.name ?? 'Worldwide', c.department].filter(Boolean).join(' · '),
    }))
  })()
  cached = { org: organizationId, p: p.catch((e) => { cached = null; throw e }) }
  return cached.p
}
