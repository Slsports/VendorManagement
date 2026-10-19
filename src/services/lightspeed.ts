import { supabase } from '@/lib/supabase'
import { functionError } from '@/services/mail'

// Settings → Lightspeed (Dana, Oct 13): the API client and the sign-in, through the lightspeed function (admin only).
// The page never sees the Client Secret or the sign-in tokens.

export interface LightspeedStatus {
  client_id: string | null; secret_saved: boolean; connected: boolean; connected_at: string | null; connected_by: string | null
  read_only: boolean | null; account_id: string | null; account_name: string | null; item_count: number | null
  checked_at: string | null; last_error: string | null; redirect_uri: string
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('lightspeed', { body })
  if (error) throw await functionError(error)
  return data as T
}

export const lightspeedStatus = () => call<LightspeedStatus>({ action: 'status' })
export const saveLightspeedClient = (clientId: string, clientSecret: string) => call<LightspeedStatus>({ action: 'save_client', client_id: clientId, client_secret: clientSecret })
export const lightspeedSignInUrl = (access: 'read' | 'full') => call<{ url: string }>({ action: 'authorize', access }).then((r) => r.url)
export const finishLightspeedSignIn = (code: string, state: string) => call<LightspeedStatus>({ action: 'exchange', code, state })
export const testLightspeed = () => call<LightspeedStatus>({ action: 'test' })
export const disconnectLightspeed = () => call<LightspeedStatus>({ action: 'disconnect' })

// ---- one PO number, created in Lightspeed (Dana, Oct 13: [VENDOR][MMDDYY] in LS's Reference #) ----

/** Reading every LS item to count them per vendor (Dana, Oct 16): runs a few minutes, then weekly on its own. */
export interface LsItemScan { started_at?: string | null; finished_at?: string | null; pages?: number; items?: number; archived?: number; no_vendor?: number; last_error?: string | null; busy?: boolean; error?: string }
export const scanLsItems = () => call<LsItemScan>({ action: 'scan_items' })
export const lsItemScanStatus = () => call<LsItemScan>({ action: 'scan_status' })

/** LS's vendors into VMS, matched to ours by name where exactly one fits. */
export const syncLsVendors = () => call<{ vendors: number; matched: number }>({ action: 'sync_vendors' })
/** The empty PO in LS for the order's vendor and store; our PO goes on the order. */
export const createLsPo = (orderId: string, shopId: string | null) => call<{ po_number: string; ls_order_id: string; shop_id: string }>({ action: 'create_po', order_id: orderId, shop_id: shopId })
/** The approved draft's items onto the order's PO in LS; returns what could not be found in LS yet. */
export const sendLsPoItems = (lsPoId: string) => call<{ po_number: string; added: number; created?: number; renamed?: number; missing: string[]; done: boolean }>({ action: 'send_items', ls_po_id: lsPoId })

export async function poNumberPreview(orderId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('po_number_next', { p_order: orderId })
  if (error) throw error
  return data
}

export interface LsVendor { ls_vendor_id: string; name: string; archived: boolean }
export async function listLsVendors(organizationId: string): Promise<LsVendor[]> {
  const { data, error } = await supabase.from('ls_vendors').select('ls_vendor_id, name, archived').eq('organization_id', organizationId).order('name').limit(2000)
  if (error) throw error
  return data ?? []
}

export async function setVendorLs(vendorId: string, lsVendorId: string | null, poCode: string | null): Promise<void> {
  const { error } = await supabase.rpc('vendor_set_ls', { p_vendor: vendorId, p_ls_vendor_id: lsVendorId ?? '', p_po_code: poCode ?? '' })
  if (error) throw error
}

/** LS locations by VMS store (SLS = Shaver Lake Sports 3, SLM = Marina 1, GS = The Happy Camper 2). */
export async function listLsShops(organizationId: string): Promise<{ code: string; name: string; ls_shop_id: string }[]> {
  const { data, error } = await supabase.from('stores').select('code, name, ls_shop_id').eq('organization_id', organizationId).not('ls_shop_id', 'is', null).order('code')
  if (error) throw error
  return (data ?? []) as { code: string; name: string; ls_shop_id: string }[]
}
