import { supabase } from '@/lib/supabase'
import { addVendorLink, uploadVendorFile } from '@/services/lines'
import { ExportError, initialsOf, lsVendorsIn, matchLsVendor, planReport, readExport, readFormattedReport, reportFileName, runText, type SalesItem } from '@/lib/salesReport'
import { suggestOrder, type IncomingLine, type IncomingStage, type SuggestedLine } from '@/lib/suggestedOrder'
import type { Order, OrderingItem, SalesReport } from '@/types'
import type { Json } from '@/types/database'

// Ordering (Dana, Oct 11–12): Check stock → To order → Placed → Confirmed (→ Overdue), with the LS PO after the
// confirmation. Flags live in ordering_items; Placed, Confirmed and Overdue come from the orders.

export type OrderingStage = 'check' | 'to_order'
/** The two flag buttons: what they say and what happens. */
export const FLAG_PROMPT: Record<OrderingStage, { button: string; title: string; help: string }> = {
  check: { button: 'Check if we need it', title: 'Check if we need it', help: 'Goes on the Ordering card under Check stock. Upload the LS sales report and VMS works out a suggested order.' },
  to_order: { button: 'Remind me to order', title: 'Remind me to order', help: 'Goes on the Ordering card under To order until the order is placed.' },
}


export const ORDERING_STAGE_LABELS: Record<OrderingStage, string> = { check: 'Check stock', to_order: 'To order' }

export interface OrderingRow extends OrderingItem {
  vendor: { id: string; name: string } | null
  assignee: { id: string; full_name: string } | null
  flagger: { id: string; full_name: string } | null
}
const ITEM_SELECT = `*, vendor:vendors!ordering_items_vendor_id_fkey(id, name), assignee:profiles!ordering_items_assigned_to_fkey(id, full_name),
  flagger:profiles!ordering_items_flagged_by_fkey(id, full_name)`

export async function listOrderingItems(organizationId: string): Promise<OrderingRow[]> {
  const { data, error } = await supabase.from('ordering_items').select(ITEM_SELECT).eq('organization_id', organizationId).neq('stage', 'done').order('created_at')
  if (error) throw error
  return (data ?? []) as unknown as OrderingRow[]
}

export async function getOpenOrderingItem(vendorId: string): Promise<OrderingRow | null> {
  const { data, error } = await supabase.from('ordering_items').select(ITEM_SELECT).eq('vendor_id', vendorId).neq('stage', 'done').maybeSingle()
  if (error) throw error
  return data as unknown as OrderingRow | null
}

/** Flag a vendor (or move its open flag): "Check if we need it" or "Remind me to order". */
export async function flagVendor(input: { organizationId: string; vendorId: string; stage: OrderingStage; note?: string | null; assignedTo?: string | null; threadId?: string | null }): Promise<void> {
  const open = await getOpenOrderingItem(input.vendorId)
  if (open) {
    const { error } = await supabase.from('ordering_items').update({ stage: input.stage, note: input.note ?? open.note, assigned_to: input.assignedTo ?? open.assigned_to, thread_id: input.threadId ?? open.thread_id }).eq('id', open.id)
    if (error) throw error
  } else {
    const { error } = await supabase.from('ordering_items').insert({ organization_id: input.organizationId, vendor_id: input.vendorId, stage: input.stage, note: input.note ?? null, assigned_to: input.assignedTo ?? null, thread_id: input.threadId ?? null })
    if (error) throw error
  }
  orderingChanged()
}

export async function moveOrderingItem(id: string, stage: OrderingStage): Promise<void> {
  const { error } = await supabase.from('ordering_items').update({ stage }).eq('id', id)
  if (error) throw error
  orderingChanged()
}

/** Close a flag: ordered (with the order), not needed, or just removed. */
export async function finishOrderingItem(id: string, outcome: 'ordered' | 'not_needed' | 'removed', orderId?: string | null): Promise<void> {
  const { error } = await supabase.from('ordering_items').update({ stage: 'done', outcome, order_id: orderId ?? null }).eq('id', id)
  if (error) throw error
  orderingChanged()
}

// ---- orders on the card --------------------------------------------------------------------------------------
export type OrderingOrderRow = Pick<Order, 'id' | 'vendor_id' | 'status' | 'po_number' | 'ls_po_number' | 'description' | 'order_date' | 'est_ship_date' | 'est_cost' | 'placed_by'> & {
  vendor: { id: string; name: string } | null
  ls_po_docs: { id: string }[]
}
const ORDER_SELECT = `id, vendor_id, status, po_number, ls_po_number, description, order_date, est_ship_date, est_cost, placed_by,
  vendor:vendors!orders_vendor_id_fkey(id, name), ls_po_docs:vendor_links!vendor_links_order_id_fkey(id)`

/** Placed (sent, no confirmation yet) and confirmed orders, with what the card needs. */
export async function listPlacedAndConfirmed(organizationId: string): Promise<OrderingOrderRow[]> {
  const { data, error } = await supabase.from('orders').select(ORDER_SELECT).eq('organization_id', organizationId)
    .in('status', ['open', 'awaiting_confirmation', 'confirmed']).eq('ls_po_docs.kind', 'ls_po')
    .order('est_ship_date', { ascending: true, nullsFirst: false }).limit(2000)
  if (error) throw error
  return (data ?? []) as unknown as OrderingOrderRow[]
}

const dayOffset = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
export const isPlaced = (o: Pick<Order, 'status'>) => o.status === 'open' || o.status === 'awaiting_confirmation'
/** Confirmed but more than 30 days past its ship date. */
export const isOverdue = (o: Pick<Order, 'status' | 'est_ship_date'>) => o.status === 'confirmed' && !!o.est_ship_date && o.est_ship_date < dayOffset(-30)
/** The LS PO is made after the confirmation: a confirmed order with no LS PO number and no LS PO document. */
export const needsLsPo = (o: Pick<OrderingOrderRow, 'status' | 'ls_po_number' | 'ls_po_docs'>) => o.status === 'confirmed' && !o.ls_po_number && !(o.ls_po_docs ?? []).length

// ---- sales reports and the suggested order ----------------------------------------------------------------
export interface ReadReport {
  items: SalesItem[]; lsVendors: { name: string; count: number }[]; guess: string | null
  /** an already formatted report (Dana, Oct 15): filed as it is, with its Order and Notes columns */
  formatted?: { file: File; runDate: string | null }
}

/** Read an LS Analytics export (xlsx or csv) and find this vendor in it; or an already formatted sales report. */
export async function readSalesExport(file: File, vendorName: string, aliases: string[]): Promise<ReadReport> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' })
  const done = readFormattedReport(wb.SheetNames.map((name) => ({ name, rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name]!, { header: 1, defval: null, raw: true, blankrows: false }) })))
  if (done) {
    if (!done.items.length) throw new ExportError('This sales report has no items.')
    const items = done.items.map((x) => ({ ...x, lsVendor: vendorName }))
    return { items, lsVendors: [{ name: vendorName, count: items.length }], guess: vendorName, formatted: { file, runDate: done.runDate } }
  }
  const sheet = wb.Sheets[wb.SheetNames[0]!]!
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true })
  const items = readExport(rows, new Date())
  const lsVendors = lsVendorsIn(items)
  return { items, lsVendors, guess: lsVendors.length === 1 ? lsVendors[0]!.name : matchLsVendor(lsVendors.map((v) => v.name), vendorName, aliases) }
}

/** Format the report (spec v49), file it in the vendor's Sales reports folder, and keep its items for the suggested order. */
export async function saveSalesReport(input: { organizationId: string; vendor: { id: string; name: string }; items: SalesItem[]; lsVendor: string; days: number; profile: { id: string; full_name: string | null }; formatted?: ReadReport['formatted'] }): Promise<SalesReport> {
  const run = input.formatted?.runDate ? new Date(`${input.formatted.runDate}T12:00:00`) : new Date()
  const plan = planReport(input.items, input.vendor.name.toUpperCase(), runText(run))
  let file: File
  if (input.formatted) {
    // already formatted: filed exactly as it is, so its Order column and notes are what the confirmation is checked against
    file = input.formatted.file
  } else {
    const { buildReportXlsx } = await import('@/lib/salesReportXlsx')
    const bytes = await buildReportXlsx(plan)
    const fileName = reportFileName(initialsOf(input.profile.full_name), run, input.vendor.name, input.days)
    file = new File([bytes], fileName, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  }
  const fileName = file.name
  const path = await uploadVendorFile(input.organizationId, input.vendor.id, file)
  const link = await addVendorLink({
    organization_id: input.organizationId, vendor_id: input.vendor.id, kind: 'sales_report', label: fileName.replace(/\.xlsx$/i, ''), storage_path: path,
    file_name: fileName, file_size: file.size, mime_type: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', received_at: run.toISOString().slice(0, 10), doc_year: run.getFullYear(), source: 'manual',
    notes: input.formatted ? 'A formatted sales report, uploaded as it is' : `LS Analytics export (${input.lsVendor}), formatted as a Vendor Sales Report (spec v49)`, created_by: input.profile.id,
  } as never)
  const summary = { active: plan.active.length, nodata: plan.nodata.length, archived: plan.archived.length, ignored: plan.ignored.length, flags: plan.flagged.length, duplicates: plan.duplicates, by_line: plan.byLine }
  const { data, error } = await supabase.from('sales_reports').insert({
    organization_id: input.organizationId, vendor_id: input.vendor.id, document_id: link.id, ls_vendor: input.lsVendor, days: input.days,
    items: input.items.map(({ notes: _notes, ...x }) => x) as unknown as Json, summary: summary as unknown as Json, created_by: input.profile.id,
  }).select('*').single()
  if (error) throw error
  const open = await getOpenOrderingItem(input.vendor.id)
  if (open) await supabase.from('ordering_items').update({ report_id: data.id }).eq('id', open.id)
  orderingChanged()
  return data
}

export async function latestSalesReport(vendorId: string): Promise<SalesReport | null> {
  const { data, error } = await supabase.from('sales_reports').select('*').eq('vendor_id', vendorId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  return data
}

interface Reading { lines?: { vendor_item_id?: string | null; description?: string | null; quantity?: number | null }[] }

/**
 * What is already coming in from a vendor, item by item: confirmed orders (the confirmation's lines), shipped or
 * received but not yet entered in LS (the invoice's lines), and placed orders (our order's lines). Orders with no
 * item list are returned separately, to check by hand.
 */
export async function incomingFor(vendorId: string): Promise<{ lines: IncomingLine[]; unlisted: { id: string; label: string; stage: IncomingStage }[] }> {
  const { data: orders, error } = await supabase.from('orders').select('id, status, po_number, description, order_date, est_ship_date')
    .eq('vendor_id', vendorId).in('status', ['open', 'awaiting_confirmation', 'confirmed', 'shipped', 'received'])
  if (error) throw error
  if (!orders?.length) return { lines: [], unlisted: [] }
  const ids = orders.map((o) => o.id)
  const [ol, checks] = await Promise.all([
    supabase.from('order_lines').select('order_id, vendor_item_id, description, quantity').in('order_id', ids),
    supabase.from('order_checks').select('order_id, kind, reading, created_at').in('order_id', ids).not('reading', 'is', null).order('created_at', { ascending: false }),
  ])
  if (ol.error) throw ol.error
  if (checks.error) throw checks.error
  const lines: IncomingLine[] = []
  const unlisted: { id: string; label: string; stage: IncomingStage }[] = []
  for (const o of orders) {
    const stage: IncomingStage = o.status === 'shipped' || o.status === 'received' ? 'shipped' : o.status === 'confirmed' ? 'confirmed' : 'placed'
    const label = [o.po_number ? `PO ${o.po_number}` : null, o.description, o.order_date ? `ordered ${new Date(`${o.order_date}T12:00:00`).toLocaleDateString()}` : null].filter(Boolean).join(' · ') || 'Order'
    const reading = (kind: 'invoice' | 'confirmation') => (checks.data ?? []).find((c) => c.order_id === o.id && c.kind === kind)?.reading as Reading | undefined
    const paper = (stage === 'shipped' ? reading('invoice') ?? reading('confirmation') : stage === 'confirmed' ? reading('confirmation') : undefined)?.lines ?? []
    const ours = (ol.data ?? []).filter((l) => l.order_id === o.id)
    const use = paper.length ? paper.map((l) => ({ vid: l.vendor_item_id ?? null, desc: l.description ?? null, qty: Number(l.quantity ?? 0) }))
      : ours.map((l) => ({ vid: l.vendor_item_id, desc: l.description, qty: Number(l.quantity) }))
    if (!use.length) { unlisted.push({ id: o.id, label, stage }); continue }
    for (const l of use) if (l.qty > 0) lines.push({ ...l, orderId: o.id, orderLabel: label, stage, expected: o.est_ship_date })
  }
  return { lines, unlisted }
}

export async function suggestedOrderFor(vendorId: string): Promise<{ report: SalesReport | null; lines: SuggestedLine[]; unlisted: { id: string; label: string; stage: IncomingStage }[] }> {
  const report = await latestSalesReport(vendorId)
  if (!report) return { report: null, lines: [], unlisted: [] }
  const incoming = await incomingFor(vendorId)
  return { report, lines: suggestOrder(report.items as unknown as SalesItem[], incoming.lines), unlisted: incoming.unlisted }
}

export async function setLsPoNumber(orderId: string, value: string | null): Promise<void> {
  const { error } = await supabase.from('orders').update({ ls_po_number: value?.trim() || null }).eq('id', orderId)
  if (error) throw error
  orderingChanged()
}

const EVENT = 'vms:ordering-changed'
export function orderingChanged() { window.dispatchEvent(new Event(EVENT)) }
export function onOrderingChanged(fn: () => void): () => void {
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}
