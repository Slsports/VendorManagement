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
    const [wwd, reps, vend] = await Promise.all([
      supabase.from('partner_contacts').select('name, email, department, partners(name)').eq('organization_id', organizationId).eq('is_active', true).not('email', 'is', null),
      supabase.from('rep_group_contacts').select('name, email, rep_groups(name)').eq('organization_id', organizationId).not('email', 'is', null),
      supabase.from('vendor_emails').select('contact_name, email, contact_type, vendors(name, is_active)').eq('organization_id', organizationId).not('email', 'is', null),
    ])
    for (const r of [wwd, reps, vend]) if (r.error) throw r.error
    return [
      ...(wwd.data ?? []).map((c) => ({ email: c.email!, name: c.name, where: [(c.partners as { name: string } | null)?.name ?? 'Worldwide', c.department].filter(Boolean).join(' · ') })),
      ...(reps.data ?? []).map((c) => ({ email: c.email!, name: c.name ?? c.email!, where: `Rep · ${(c.rep_groups as { name: string } | null)?.name ?? 'rep group'}` })),
      ...(vend.data ?? []).filter((c) => (c.vendors as { is_active: boolean } | null)?.is_active !== false)
        .map((c) => ({ email: c.email!, name: c.contact_name ?? c.email!, where: (c.vendors as { name: string } | null)?.name ?? 'Vendor' })),
    ]
  })()
  cached = { org: organizationId, p: p.catch((e) => { cached = null; throw e }) }
  return cached.p
}
