import { supabase } from '@/lib/supabase'
import type { VendorItemRule } from '@/types'
import type { TablesInsert } from '@/types/database'

export async function listItemRules(vendorId: string): Promise<VendorItemRule[]> {
  const { data, error } = await supabase
    .from('vendor_item_rules')
    .select('*')
    .eq('vendor_id', vendorId)
    .order('scope', { ascending: false })
    .order('rule', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function addItemRule(row: TablesInsert<'vendor_item_rules'>): Promise<VendorItemRule> {
  const { data, error } = await supabase.from('vendor_item_rules').insert(row).select('*').single()
  if (error) throw error
  return data
}

export async function deleteItemRule(id: string): Promise<void> {
  const { error } = await supabase.from('vendor_item_rules').delete().eq('id', id)
  if (error) throw error
}
