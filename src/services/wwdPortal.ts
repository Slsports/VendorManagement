import { supabase } from '@/lib/supabase'
import { functionError } from '@/services/mail'
import type { VendorProgram, WwdPortalVendor } from '@/types'

/** What the Worldwide portal said about a vendor (one or more portal entries) and its programs, newest first. */
export async function vendorPortal(vendorId: string): Promise<{ entries: WwdPortalVendor[]; programs: VendorProgram[] }> {
  const [e, p] = await Promise.all([
    supabase.from('wwd_portal_vendors').select('*').eq('vendor_id', vendorId).order('name'),
    supabase.from('vendor_programs').select('*').eq('vendor_id', vendorId).order('kind', { ascending: false }).order('year', { ascending: false, nullsFirst: false }).order('expires_on', { ascending: false, nullsFirst: false }),
  ])
  if (e.error) throw e.error
  if (p.error) throw p.error
  return { entries: e.data ?? [], programs: p.data ?? [] }
}

export interface PortalStatus { portal: number; tied: number; lines: number; cards: number; conflicts: number; imported_read_at: string | null; last_read_at: string | null }
export interface PortalImport { portal: number; tied: number; tied_by: Record<string, number>; lines_new: number; lines: number; cards: number; landed: { vendors: number; filled: Record<string, number>; asked: Record<string, number>; people: number; reps: number; programs: number } }

async function call<T>(action: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke('wwd-portal', { body: { action } })
  if (error) throw await functionError(error)
  return data as T
}
export const portalStatus = () => call<PortalStatus>('status')
export const importPortal = () => call<PortalImport>('import')
