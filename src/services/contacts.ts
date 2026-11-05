import { supabase } from '@/lib/supabase'
import { TEST_LOGIN_PATTERN } from '@/services/reviews'

export interface AddressBookEntry { email: string; name: string; where: string }

/**
 * People you can add to an email by typing a name or where they work: our own staff, WWD contacts, rep group reps and
 * every vendor contact (Dana, Nov 5: "jarr" found nothing; staff and all vendor contacts now come up). Loaded once per page visit.
 */
let cached: { org: string; p: Promise<AddressBookEntry[]> } | null = null
export function listAddressBook(organizationId: string): Promise<AddressBookEntry[]> {
  if (cached?.org === organizationId) return cached.p
  const p = (async () => {
    const [staff, wwd, reps, vend] = await Promise.all([
      supabase.from('profiles').select('full_name, email').eq('organization_id', organizationId).eq('is_active', true).not('email', 'ilike', TEST_LOGIN_PATTERN),
      supabase.from('partner_contacts').select('name, email, department, partners(name)').eq('organization_id', organizationId).eq('is_active', true).not('email', 'is', null),
      // former contacts are never suggested (Dana, Oct 19); they stay on the vendor page for finding old mail
      supabase.from('rep_group_contacts').select('name, email, rep_groups(name)').eq('organization_id', organizationId).not('email', 'is', null).is('former_at', null),
      supabase.from('vendor_emails').select('contact_name, email, contact_type, vendors!vendor_emails_vendor_id_fkey(name, is_active)').eq('organization_id', organizationId).not('email', 'is', null).is('former_at', null),
    ])
    for (const r of [staff, wwd, reps, vend]) if (r.error) throw r.error
    const brand = 'Shaver Lake Sports'
    return [
      ...(staff.data ?? []).filter((p) => p.email).map((p) => ({ email: p.email, name: p.full_name || p.email, where: brand })),
      ...(wwd.data ?? []).map((c) => ({ email: c.email!, name: c.name, where: [(c.partners as { name: string } | null)?.name ?? 'Worldwide', c.department].filter(Boolean).join(' · ') })),
      ...(reps.data ?? []).map((c) => ({ email: c.email!, name: c.name ?? c.email!, where: `Rep · ${(c.rep_groups as { name: string } | null)?.name ?? 'rep group'}` })),
      // every vendor's people, an inactive vendor's marked so (Dana, Nov 5: "any vendor contact email")
      ...(vend.data ?? []).map((c) => { const v = c.vendors as { name: string; is_active: boolean } | null; return { email: c.email!, name: c.contact_name ?? c.email!, where: v ? `${v.name}${v.is_active === false ? ' (inactive)' : ''}` : 'Vendor' } }),
    ]
  })()
  cached = { org: organizationId, p: p.catch((e) => { cached = null; throw e }) }
  return cached.p
}
