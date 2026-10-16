import { supabase } from '@/lib/supabase'
import { buildInventoryXlsx, inventoryFileName, sortCountLines, type CountLine } from '@/lib/inventoryXlsx'
import { addVendorLink, uploadVendorFile } from '@/services/lines'
import { fetchReportItems, reportName, type LsStore, type LsVendorChoice, type ReportParams } from '@/services/lsReports'
import type { Json, Tables } from '@/types/database'

// Inventory checklists (Dana, Oct 16): a count sheet for a vendor or category and one store, filed under the vendor;
// counts typed in on the checklist page; Send to LS makes an Inventory Count in Lightspeed.

export type InventoryCount = Tables<'inventory_counts'>
export type InventoryCountLine = Tables<'inventory_count_lines'>

export interface ChecklistResult { count: InventoryCount; file: File }

/** Build the sheet from the copy of Lightspeed, file it, and keep the lines for the count entry page. */
export async function runInventoryChecklist(input: { organizationId: string; params: ReportParams; stores: LsStore[]; vendors: LsVendorChoice[]; profile: { id: string; full_name: string | null } }): Promise<ChecklistResult> {
  const { organizationId, params: p, profile } = input
  const store = input.stores.find((s) => s.code === p.store_codes[0])
  if (!store) throw new Error('Pick the store the count is for')
  const items = await fetchReportItems(organizationId, { ...p, store_mode: 'one', store_codes: [store.code] }, input.stores)
  const live = items.filter((x) => !x.archived)
  if (!live.length) throw new Error('No items match. Check the vendor, category and store.')
  const name = reportName({ ...p, kind: 'vendor' }, input.vendors).replace(/^ALL /, '')
  const run = new Date()
  const lines: CountLine[] = sortCountLines(live.map((x) => ({ system_sku: x.sid, upc: x.upc, vendor_name: x.lsVendor, vendor_item_id: x.vid, description: x.desc, category_path: x.cat, in_stock: x.qoh })))
  const bytes = await buildInventoryXlsx(lines)
  const fileName = inventoryFileName(run, `${name} ${store.code}`)
  const file = new File([bytes], fileName, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const one = p.vendor_ids.length === 1 ? input.vendors.find((v) => v.ls_vendor_id === p.vendor_ids[0]) : null
  let document_id: string | null = null, storage_path: string
  if (one?.vendor_id) {
    storage_path = await uploadVendorFile(organizationId, one.vendor_id, file)
    const link = await addVendorLink({
      organization_id: organizationId, vendor_id: one.vendor_id, kind: 'inventory_count', label: fileName.replace(/\.xlsx$/i, ''), storage_path, file_name: fileName, file_size: file.size, mime_type: file.type,
      received_at: run.toISOString().slice(0, 10), doc_year: run.getFullYear(), source: 'manual', notes: `Inventory checklist for ${store.code} from Lightspeed`, created_by: profile.id,
    } as never)
    document_id = link.id
  } else {
    storage_path = `${organizationId}/reports/${crypto.randomUUID()}-${fileName.replace(/[^A-Za-z0-9._-]+/g, '_')}`
    const { error } = await supabase.storage.from('vendor-files').upload(storage_path, file, { contentType: file.type, upsert: false })
    if (error) throw error
  }
  const { data: run_row, error: rerr } = await supabase.from('report_runs').insert({
    organization_id: organizationId, kind: 'inventory', title: `${name} (${store.code})`, params: p as unknown as Json, file_name: fileName, storage_path: document_id ? null : storage_path, document_id,
    summary: { items: lines.length } as unknown as Json, created_by: profile.id,
  }).select('*').single()
  if (rerr) throw rerr
  const { data: count, error } = await supabase.from('inventory_counts').insert({
    organization_id: organizationId, title: fileName.replace(/\.xlsx$/i, ''), store_code: store.code, shop_id: store.shop_id, vendor_id: one?.vendor_id ?? null, params: p as unknown as Json,
    file_name: fileName, storage_path: document_id ? null : storage_path, document_id, run_id: run_row.id, ls_count_name: fileName.replace(/\.xlsx$/i, ''), created_by: profile.id,
  }).select('*').single()
  if (error) throw error
  const itemIds = new Map(live.map((x) => [x.sid, x]))
  const rows = lines.map((l, i) => {
    const x = itemIds.get(l.system_sku)!
    return { organization_id: organizationId, count_id: count.id, item_id: x.lsItemId ?? l.system_sku, system_sku: l.system_sku, upc: l.upc, vendor_name: l.vendor_name, vendor_item_id: l.vendor_item_id, description: l.description, category_path: l.category_path, in_stock: l.in_stock, sort_order: i }
  })
  for (let i = 0; i < rows.length; i += 500) {
    const { error: lerr } = await supabase.from('inventory_count_lines').insert(rows.slice(i, i + 500))
    if (lerr) throw lerr
  }
  await supabase.from('report_runs').update({ summary: { items: lines.length, count_id: count.id } as unknown as Json }).eq('id', run_row.id)
  return { count, file }
}

export async function listInventoryCounts(organizationId: string, limit = 100): Promise<InventoryCount[]> {
  const { data, error } = await supabase.from('inventory_counts').select('*').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return data ?? []
}

export async function getInventoryCount(id: string): Promise<{ count: InventoryCount; lines: InventoryCountLine[] } | null> {
  const { data, error } = await supabase.from('inventory_counts').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  if (!data) return null
  const { data: lines, error: lerr } = await supabase.rpc('inventory_count_lines_for', { p_count: id })
  if (lerr) throw lerr
  return { count: data, lines: lines ?? [] }
}

/** The numbers from the paper sheet: Floor, Back stock, Bins and Total (Total alone is enough). */
export async function saveCountLine(id: string, values: { floor: number | null; back_stock: number | null; bins: number | null; total: number | null }, userId: string) {
  const { error } = await supabase.from('inventory_count_lines').update({ ...values, entered_by: userId, entered_at: new Date().toISOString() }).eq('id', id)
  if (error) throw error
}

export interface SendResult { ls_count_id: string; name: string; sent: number; failed: string[] }

/** Send to LS: a new Inventory Count in Lightspeed with the totals entered so far. */
export async function sendCountToLs(countId: string, name: string): Promise<SendResult> {
  const { data, error } = await supabase.functions.invoke('ls-inventory-count', { body: { count_id: countId, name } })
  if (error) {
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') { try { const b = await ctx.json(); if (b?.error) throw new Error(String(b.error)) } catch (e) { if (e instanceof Error && e.message && !/json/i.test(e.message)) throw e } }
    throw error
  }
  if (data?.error) throw new Error(data.error)
  return data as SendResult
}

export async function downloadCountFile(c: InventoryCount): Promise<Blob> {
  let path = c.storage_path
  if (!path && c.document_id) {
    const { data } = await supabase.from('vendor_links').select('storage_path').eq('id', c.document_id).maybeSingle()
    path = data?.storage_path ?? null
  }
  if (!path) throw new Error('The sheet for this checklist is gone')
  const { data, error } = await supabase.storage.from('vendor-files').download(path)
  if (error) throw error
  return data
}
