import { supabase } from '@/lib/supabase'
import { initialsOf, orderNeed, planReport, reportFileName, runText, type ReportOptions, type ReportPlan, type SalesItem } from '@/lib/salesReport'
import { markItemStatus } from '@/lib/itemStatus'
import { incomingFor, saveSalesReport } from '@/services/ordering'
import { ADDONS_LABELS, matchIncoming, onOrderNote } from '@/lib/addOns'
import { openOrdersForVendor } from '@/services/addOns'
import { checkUploadSize } from '@/lib/upload'
import type { Json, Tables } from '@/types/database'

// Sales Reports from Lightspeed (Dana, Oct 16; decisions "Reports from Lightspeed, replacing LS Analytics"): the items
// and sale lines ls-sync keeps in VMS become vendor and category reports by spec v49, for all stores together, one
// store, or the stores kept apart. Vendor runs file under the vendor like an uploaded report (and feed the suggested
// order); category runs file under Reports.

export type ReportRun = Tables<'report_runs'>
export type ReportPreset = Tables<'report_presets'>
export type StoreMode = 'together' | 'one' | 'separate'

export interface ReportParams {
  kind: 'vendor' | 'category' | 'inventory'
  /** LS vendor ids (one or more for a vendor report; any number, usually none, for a category report). */
  vendor_ids: string[]
  /** LS category paths; an item counts when its category is one of these or under one. */
  categories: string[]
  store_mode: StoreMode
  /** Store codes (SLS, SLM, GS): all for "together" and "separate", one for "one". */
  store_codes: string[]
  from: string
  to: string
  /** The number of days when the period is "the last N days" (the file name says "365 DAYS"); null for a date range. */
  days: number | null
}

export const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
export const daysAgoIso = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }

export const DEFAULT_PARAMS: ReportParams = { kind: 'vendor', vendor_ids: [], categories: [], store_mode: 'together', store_codes: [], from: daysAgoIso(365), to: todayIso(), days: 365 }

export interface LsStore { code: string; name: string; shop_id: string }

/** The stores on the connected Lightspeed account (SLH is a separate account and has no shop here). */
export async function listLsStores(organizationId: string): Promise<LsStore[]> {
  const { data, error } = await supabase.from('stores').select('code, name, ls_shop_id').eq('organization_id', organizationId).not('ls_shop_id', 'is', null).order('code')
  if (error) throw error
  return (data ?? []).map((s) => ({ code: s.code, name: s.name, shop_id: s.ls_shop_id! }))
}

export interface LsVendorChoice { ls_vendor_id: string; name: string; vendor_id: string | null; vendor_name: string | null }

/** Lightspeed's vendors, each with the VMS vendor it is matched to (when it is). */
export async function listLsVendorChoices(organizationId: string): Promise<LsVendorChoice[]> {
  const [{ data: ls, error }, { data: ours, error: e2 }] = await Promise.all([
    supabase.from('ls_vendors').select('ls_vendor_id, name').eq('organization_id', organizationId).eq('archived', false).order('name'),
    supabase.from('vendors').select('id, name, lightspeed_vendor_id').eq('organization_id', organizationId).not('lightspeed_vendor_id', 'is', null),
  ])
  if (error) throw error
  if (e2) throw e2
  const byLs = new Map((ours ?? []).map((v) => [v.lightspeed_vendor_id as string, v]))
  return (ls ?? []).map((v) => { const o = byLs.get(v.ls_vendor_id); return { ls_vendor_id: v.ls_vendor_id, name: v.name, vendor_id: o?.id ?? null, vendor_name: o?.name ?? null } })
}

export async function listLsCategories(organizationId: string): Promise<{ category_path: string; items: number }[]> {
  const { data, error } = await supabase.rpc('ls_categories', { p_org: organizationId })
  if (error) throw error
  return data ?? []
}

export interface SyncStatus { items_seen: number; items_pass_finished: string | null; lines_since: string | null; lines_backfill_done: boolean; sales_backfill_done: boolean; backfill_from: string; older_to: string | null; older_lines_done: boolean; last_error: string | null; items: number; lines: number }

/** How fresh the copy of Lightspeed is: when the last item pass finished, how far the sales reach. */
export async function lsSyncStatus(organizationId: string): Promise<SyncStatus | null> {
  const { data, error } = await supabase.from('ls_sync').select('*').eq('organization_id', organizationId).maybeSingle()
  if (error) throw error
  if (!data) return null
  const [{ count: items }, { count: lines }] = await Promise.all([
    supabase.from('ls_items').select('item_id', { count: 'exact', head: true }).eq('organization_id', organizationId),
    supabase.from('ls_sale_lines').select('sale_line_id', { count: 'exact', head: true }).eq('organization_id', organizationId),
  ])
  return { items_seen: data.items_seen, items_pass_finished: data.items_pass_finished, lines_since: data.lines_since, lines_backfill_done: data.lines_backfill_done, sales_backfill_done: data.sales_backfill_done, backfill_from: data.backfill_from, older_to: data.older_to, older_lines_done: data.older_lines_done, last_error: data.last_error, items: items ?? 0, lines: lines ?? 0 }
}

type Row = { item_id: string; system_sku: string; upc: string; vendor_item_id: string; custom_sku: string; manufacturer_sku: string; description: string; default_cost: number | null; category_path: string; default_vendor_id: string; vendor_name: string; archived: boolean; item_type: string; qoh: Record<string, number>; sold: Record<string, number>; sold_total: number; last_sold: string | null; note: string; note_public: boolean }

/** The report's items from the copy of Lightspeed: sold in the period and on hand, per chosen store and combined. */
export async function fetchReportItems(organizationId: string, p: ReportParams, stores: LsStore[]): Promise<SalesItem[]> {
  const chosen = stores.filter((s) => p.store_codes.includes(s.code))
  if (!chosen.length) throw new Error('Pick at least one store')
  const { data, error } = await supabase.rpc('ls_report_rows', {
    p_org: organizationId, p_from: p.from, p_to: p.to, p_shops: chosen.map((s) => s.shop_id),
    p_vendor_ids: p.vendor_ids.length ? p.vendor_ids : null, p_category_prefixes: p.categories.length ? p.categories : null,
  })
  if (error) throw error
  return ((data ?? []) as unknown as Row[]).map((r) => {
    const byStore: Record<string, { sold: number; qoh: number }> = {}
    let sold = 0, qoh = 0
    for (const s of chosen) {
      const st = { sold: Math.round(Number(r.sold?.[s.shop_id] ?? 0)), qoh: Math.round(Number(r.qoh?.[s.shop_id] ?? 0)) }
      byStore[s.code] = st
      sold += st.sold
      qoh += st.qoh
    }
    const nonInv = r.item_type === 'non_inventory'
    return {
      sid: r.system_sku || r.item_id, upc: r.upc, lsVendor: r.vendor_name, vid: r.vendor_item_id || r.manufacturer_sku || r.custom_sku, desc: r.description,
      cost: r.default_cost == null ? null : Number(r.default_cost), cat: r.category_path, archived: r.archived, sold, nonInv, qoh: nonInv ? 0 : qoh, last: r.last_sold, notes: [],
      lsVendorId: r.default_vendor_id,
      lsItemId: r.item_id,
      lsNote: r.note || undefined,
      byStore: p.store_mode === 'separate' ? byStore : undefined,
    }
  })
}

/** The report's name: the vendor(s) or the category, as the file and the title say it. */
export function reportName(p: ReportParams, vendors: LsVendorChoice[]): string {
  const names = p.vendor_ids.map((id) => vendors.find((v) => v.ls_vendor_id === id)?.vendor_name ?? vendors.find((v) => v.ls_vendor_id === id)?.name ?? id)
  const cats = p.categories.map((c) => c.split('/').slice(-2).join('/'))
  if (p.kind === 'vendor') return [names.join(' + '), cats.length ? `(${cats.join(', ')})` : ''].filter(Boolean).join(' ')
  return [cats.length ? `ALL ${cats.join(', ')}` : 'ALL CATEGORIES', names.length ? `(${names.join(' + ')})` : ''].filter(Boolean).join(' ')
}

export interface RunResult { run: ReportRun; file: File; plan: ReportPlan }

/** Build the report, file it, remember the run. */
export async function runLsReport(input: { organizationId: string; params: ReportParams; stores: LsStore[]; vendors: LsVendorChoice[]; profile: { id: string; full_name: string | null } }): Promise<RunResult> {
  const { organizationId, params: p, profile } = input
  const items = await fetchReportItems(organizationId, p, input.stores)
  if (!items.length) throw new Error('No items match. Check the vendor, category and stores.')
  const name = reportName(p, input.vendors)
  const run = new Date()
  // what is already coming in from each VMS vendor on the report (Dana, Oct 16), and the add-on hint per order
  const vendorIds = [...new Set(items.map((x) => input.vendors.find((v) => v.ls_vendor_id === x.lsVendorId)?.vendor_id).filter((x): x is string => !!x))]
  const openOrders: string[] = []
  const addonsByOrder = new Map<string, 'yes' | 'no' | 'ask' | null>()
  const incoming = (await Promise.all(vendorIds.map(async (vendorId) => {
    const [inc, open] = await Promise.all([incomingFor(vendorId), openOrdersForVendor(vendorId)])
    for (const u of inc.unlisted) openOrders.push(u.label)
    for (const o of open) addonsByOrder.set(o.id, o.addons)
    return inc.lines
  }))).flat()
  // discontinued (*), do not reorder (**), out of stock and replacements from the LS names and notes (Dana, Oct 18)
  const marked = markItemStatus(items)
  const matched = matchIncoming(items, incoming)
  for (const x of items) {
    const m = matched.get(x.sid)
    x.onOrder = m?.qty ?? 0
    if (m) {
      const hint = m.from.map((f) => { const a = addonsByOrder.get(f.orderId); return f.stage === 'shipped' ? null : a === 'yes' ? `add to ${f.orderLabel.split(' · ')[0]}` : `${f.orderLabel.split(' · ')[0]}: add-ons ${a ? ADDONS_LABELS[a].toLowerCase() : 'not confirmed'}` }).filter(Boolean)
      x.notes.push(`On order: ${onOrderNote(m)}.${hint.length ? ` ${hint.join('; ')}.` : ''}`)
    }
  }
  const opts: ReportOptions = { kind: p.kind === 'category' ? 'category' : 'vendor', stores: p.store_mode === 'separate' ? p.store_codes : null, onOrder: true, openOrders }
  const plan = planReport(items, name.toUpperCase(), runText(run), opts)
  const { buildReportXlsx } = await import('@/lib/salesReportXlsx')
  const bytes = await buildReportXlsx(plan)
  const fileName = reportFileName(initialsOf(profile.full_name), run, name, p.days ?? { from: p.from, to: p.to })
  const file = new File([bytes], fileName, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const summary = { items: items.length, active: plan.active.length, nodata: plan.nodata.length, archived: plan.archived.length, ignored: plan.ignored.length, flags: plan.flagged.length, duplicates: plan.duplicates, sizes: plan.sizes?.length ?? 0, sold: items.reduce((s, x) => s + x.sold, 0), need: items.reduce((s, x) => s + orderNeed(x), 0), ...marked }
  const one = p.kind === 'vendor' && p.vendor_ids.length === 1 ? input.vendors.find((v) => v.ls_vendor_id === p.vendor_ids[0]) : null
  let document_id: string | null = null, sales_report_id: string | null = null, storage_path: string | null = null
  if (one?.vendor_id) {
    // a vendor's report files under the vendor and feeds its suggested order, like an uploaded one
    const saved = await saveSalesReport({ organizationId, vendor: { id: one.vendor_id, name: one.vendor_name ?? one.name }, items, lsVendor: one.name, days: p.days ?? 365, profile, prebuilt: { plan, file, note: `From Lightspeed (${p.store_mode === 'one' ? p.store_codes[0] : p.store_mode === 'separate' ? `${p.store_codes.join(', ')} kept apart` : 'all stores'}), ${p.from} to ${p.to}` } })
    document_id = saved.document_id
    sales_report_id = saved.id
  } else {
    checkUploadSize(file)
    storage_path = `${organizationId}/reports/${crypto.randomUUID()}-${fileName.replace(/[^A-Za-z0-9._-]+/g, '_')}`
    const { error } = await supabase.storage.from('vendor-files').upload(storage_path, file, { contentType: file.type, upsert: false })
    if (error) throw error
    // a category report is also on the page of every vendor on its Active tab, and any vendor picked (Dana, Oct 16: "it just
    // does it automatically"); one file, a link per vendor
    const lsIds = new Set([...p.vendor_ids, ...plan.active.map((x) => x.lsVendorId ?? '').filter(Boolean)])
    const under = [...new Set([...lsIds].map((id) => input.vendors.find((v) => v.ls_vendor_id === id)?.vendor_id).filter((x): x is string => !!x))]
    for (const vendorId of under) {
      const { error: lerr } = await supabase.from('vendor_links').insert({
        organization_id: organizationId, vendor_id: vendorId, kind: 'sales_report', label: fileName.replace(/\.xlsx$/i, ''), storage_path, file_name: fileName, file_size: file.size, mime_type: file.type,
        received_at: run.toISOString().slice(0, 10), doc_year: run.getFullYear(), source: 'manual', notes: `Category report (${name}) from Lightspeed, ${p.from} to ${p.to}`, created_by: profile.id,
      } as never)
      if (lerr) throw lerr
    }
  }
  const { data, error } = await supabase.from('report_runs').insert({
    organization_id: organizationId, kind: p.kind === 'category' ? 'category' : 'vendor', title: name, params: p as unknown as Json, file_name: fileName, storage_path, document_id, sales_report_id, summary: summary as unknown as Json, created_by: profile.id,
  }).select('*').single()
  if (error) throw error
  return { run: data, file, plan }
}

export async function listReportRuns(organizationId: string, limit = 100): Promise<ReportRun[]> {
  const { data, error } = await supabase.from('report_runs').select('*').eq('organization_id', organizationId).order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return data ?? []
}

/** The run's file, from the vendor's folder or the Reports folder. */
export async function downloadRunFile(run: ReportRun): Promise<Blob> {
  let path = run.storage_path
  if (!path && run.document_id) {
    const { data } = await supabase.from('vendor_links').select('storage_path').eq('id', run.document_id).maybeSingle()
    path = data?.storage_path ?? null
  }
  if (!path) throw new Error('The file for this run is gone')
  const { data, error } = await supabase.storage.from('vendor-files').download(path)
  if (error) throw error
  return data
}

export async function listReportPresets(organizationId: string): Promise<ReportPreset[]> {
  const { data, error } = await supabase.from('report_presets').select('*').eq('organization_id', organizationId).order('name')
  if (error) throw error
  return data ?? []
}

export async function saveReportPreset(organizationId: string, name: string, params: ReportParams, userId: string): Promise<ReportPreset> {
  const { data, error } = await supabase.from('report_presets').upsert({ organization_id: organizationId, name: name.trim(), kind: params.kind, params: params as unknown as Json, created_by: userId }, { onConflict: 'organization_id,name' }).select('*').single()
  if (error) throw error
  return data
}

export async function deleteReportPreset(id: string) {
  const { error } = await supabase.from('report_presets').delete().eq('id', id)
  if (error) throw error
}
