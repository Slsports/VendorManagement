import { supabase } from '@/lib/supabase'
import type { BillingRoute, Partner, PartnerContact, TablesInsert, TablesUpdate } from '@/types'

export interface PartnerWithContacts extends Partner {
  partner_contacts: PartnerContact[]
}

/** The partner behind a billing route (Worldwide for 'worldwide') with its people, or null if none is set up. */
export async function getPartner(organizationId: string, route: BillingRoute): Promise<PartnerWithContacts | null> {
  const { data, error } = await supabase
    .from('partners')
    .select('*, partner_contacts(*)')
    .eq('organization_id', organizationId)
    .eq('route', route)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  const contacts = (data.partner_contacts ?? []).filter((c) => c.is_active).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
  return { ...data, partner_contacts: contacts }
}

export async function upsertPartner(input: TablesInsert<'partners'>): Promise<Partner> {
  const { data, error } = await supabase.from('partners').upsert(input, { onConflict: 'organization_id,route' }).select('*').single()
  if (error) throw error
  return data
}

export async function updatePartner(id: string, changes: TablesUpdate<'partners'>): Promise<void> {
  const { error } = await supabase.from('partners').update(changes).eq('id', id)
  if (error) throw error
}

export async function addPartnerContact(input: TablesInsert<'partner_contacts'>): Promise<PartnerContact> {
  const { data, error } = await supabase.from('partner_contacts').insert(input).select('*').single()
  if (error) throw error
  return data
}

export async function updatePartnerContact(id: string, changes: TablesUpdate<'partner_contacts'>): Promise<void> {
  const { error } = await supabase.from('partner_contacts').update(changes).eq('id', id)
  if (error) throw error
}

export async function deletePartnerContact(id: string): Promise<void> {
  const { error } = await supabase.from('partner_contacts').delete().eq('id', id)
  if (error) throw error
}
