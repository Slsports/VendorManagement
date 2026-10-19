import { supabase } from '@/lib/supabase'
import { functionError } from '@/services/mail'
import type { LsNameItem, NameVendor } from '@/lib/itemNames'
import type { ItemNameChange } from '@/types'

// Item names (SOP-INV-001-NC): the LS items, the people's decisions, and the queue the lightspeed function sends from.

/** Every active LS item's name (from VMS's copy of LS, a thousand at a time). */
export async function listLsItemNames(organizationId: string): Promise<LsNameItem[]> {
  const out: LsNameItem[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('ls_items')
      .select('item_id, description, vendor_item_id, category_path, default_vendor_id')
      .eq('organization_id', organizationId)
      .eq('archived', false)
      .order('item_id')
      .range(from, from + 999)
    if (error) throw error
    out.push(...((data ?? []) as LsNameItem[]))
    if (!data || data.length < 1000) return out
  }
}

export async function listNameVendors(organizationId: string): Promise<NameVendor[]> {
  const { data, error } = await supabase
    .from('vendors')
    .select('id, name, lightspeed_vendor_id, vid_in_description')
    .eq('organization_id', organizationId)
    .not('lightspeed_vendor_id', 'is', null)
  if (error) throw error
  return (data ?? []) as NameVendor[]
}

/** Decisions still open, plus what went to LS in the last two weeks. */
export async function listItemNameChanges(organizationId: string): Promise<ItemNameChange[]> {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString()
  const { data, error } = await supabase
    .from('item_name_changes')
    .select('*')
    .eq('organization_id', organizationId)
    .or(`status.neq.sent,sent_at.gte.${since}`)
    .order('approved_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export interface NameDecision { ls_item_id: string; old_name: string; new_name?: string; kind?: 'cosmetic' | 'content'; vendor_id?: string | null }

/** Approve renames (they go to LS from the queue), or leave names as they are (skip). */
export async function decideItemNames(organizationId: string, items: NameDecision[], skip = false): Promise<number> {
  let n = 0
  for (let i = 0; i < items.length; i += 500) {
    const { data, error } = await supabase.rpc('item_names_decide', { p_org: organizationId, p_items: items.slice(i, i + 500) as never, p_skip: skip })
    if (error) throw error
    n += data ?? 0
  }
  return n
}

export async function undoItemNames(ids: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('item_names_undo', { p_ids: ids })
  if (error) throw error
  return data ?? 0
}

export interface RenameRun { sent: number; failed: number; waiting: number; error?: string }

/** Send approved names to LS now (the rest go every 2 minutes on their own). */
export async function sendItemNamesNow(): Promise<RenameRun> {
  const { data, error } = await supabase.functions.invoke('lightspeed', { body: { action: 'rename_now' } })
  if (error) throw await functionError(error)
  return data as RenameRun
}
