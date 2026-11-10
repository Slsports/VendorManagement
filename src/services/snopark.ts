// Sno-Park passes (Dana, Nov 5-6, 2026): the season, its books and its monthly reports.
import { supabase } from '@/lib/supabase'
import { addVendorLink, uploadVendorFile } from '@/services/lines'
import { photoForUpload } from '@/lib/photo'
import type { Difference, Sheet, SeasonCheck } from '@/lib/snopark'
import type { Json, SnoparkBook, SnoparkReport, SnoparkReportRow, SnoparkSeason, SnoparkShipment, VendorLink } from '@/types'

export interface SeasonView { season: SnoparkSeason; books: SnoparkBook[]; reports: SnoparkReport[]; shipments: SnoparkShipment[]; vendor: { id: string; name: string } | null; form: VendorLink | null }

/** The open season, else the latest one; null when none has been opened. */
export async function getSeason(organizationId: string, seasonId?: string | null): Promise<SeasonView | null> {
  let q = supabase.from('snopark_seasons').select('*').eq('organization_id', organizationId)
  q = seasonId ? q.eq('id', seasonId) : q.order('status', { ascending: false }).order('label', { ascending: false })
  const { data: seasons, error } = await q.limit(1)
  if (error) throw error
  const season = seasons?.[0]
  if (!season) return null
  const [books, reports, shipments, vendor, form] = await Promise.all([
    supabase.from('snopark_books').select('*').eq('season_id', season.id).order('kind').order('first_permit'),
    supabase.from('snopark_reports').select('*').eq('season_id', season.id).order('seq'),
    supabase.from('snopark_shipments').select('*').eq('season_id', season.id).order('received_on', { ascending: false }),
    season.vendor_id ? supabase.from('vendors').select('id, name').eq('id', season.vendor_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    season.form_link_id ? supabase.from('vendor_links').select('*').eq('id', season.form_link_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ])
  if (books.error) throw books.error
  if (reports.error) throw reports.error
  if (shipments.error) throw shipments.error
  return { season, books: books.data ?? [], reports: reports.data ?? [], shipments: shipments.data ?? [], vendor: vendor.data ?? null, form: form.data ?? null }
}

export async function listSeasons(organizationId: string): Promise<SnoparkSeason[]> {
  const { data, error } = await supabase.from('snopark_seasons').select('*').eq('organization_id', organizationId).order('label', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function openSeasonByHand(label: string): Promise<string> {
  const { data, error } = await supabase.rpc('snopark_season_open_by_hand', { p_label: label })
  if (error) throw error
  return data
}

export interface AddBooksInput { season_id: string; kind: SnoparkBook['kind']; first_book: string; books: number; per_book: number; first_permit: number; received_on: string | null; order_id: string | null }
export async function addBooks(i: AddBooksInput): Promise<number> {
  const { data, error } = await supabase.rpc('snopark_books_add', { p_season: i.season_id, p_kind: i.kind, p_first_book: i.first_book, p_books: i.books, p_per_book: i.per_book, p_first_permit: i.first_permit, p_received: i.received_on, p_order: i.order_id })
  if (error) throw error
  return data
}

/** A book entered by mistake, while it is still on hand. */
export async function deleteBook(id: string): Promise<void> {
  const { error } = await supabase.from('snopark_books').delete().eq('id', id).eq('status', 'on_hand')
  if (error) throw error
}

export async function updateBook(id: string, patch: { notes?: string | null; received_on?: string | null; order_id?: string | null }): Promise<void> {
  const { error } = await supabase.from('snopark_books').update(patch).eq('id', id)
  if (error) throw error
}

export interface ReportView { report: SnoparkReport; season: SnoparkSeason; rows: SnoparkReportRow[]; books: SnoparkBook[]; file: VendorLink | null; print: VendorLink | null; packet: VendorLink | null; scans: VendorLink[]; vendor: { id: string; name: string } | null }

export async function getReport(id: string): Promise<ReportView | null> {
  const { data: report, error } = await supabase.from('snopark_reports').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  if (!report) return null
  const one = (linkId: string | null) => (linkId ? supabase.from('vendor_links').select('*').eq('id', linkId).maybeSingle() : Promise.resolve({ data: null, error: null }))
  const [season, rows, books, file, print, packet, scans] = await Promise.all([
    supabase.from('snopark_seasons').select('*').eq('id', report.season_id).single(),
    supabase.from('snopark_report_rows').select('*').eq('report_id', id).order('sort'),
    supabase.from('snopark_books').select('*').eq('season_id', report.season_id).order('kind').order('first_permit'),
    one(report.file_link_id), one(report.print_link_id), one(report.packet_link_id),
    report.scan_link_ids.length ? supabase.from('vendor_links').select('*').in('id', report.scan_link_ids).order('created_at') : Promise.resolve({ data: [], error: null }),
  ])
  if (season.error) throw season.error
  if (rows.error) throw rows.error
  if (books.error) throw books.error
  const vendor = season.data.vendor_id ? (await supabase.from('vendors').select('id, name').eq('id', season.data.vendor_id).maybeSingle()).data : null
  return { report, season: season.data, rows: rows.data ?? [], books: books.data ?? [], file: file.data ?? null, print: print.data ?? null, packet: packet.data ?? null, scans: scans.data ?? [], vendor }
}

/** The books picked as sold: to_permit is the last permit sold (left out = the whole book). */
export async function buildReport(reportId: string, sold: { book_id: string; to_permit?: number }[]): Promise<void> {
  const { error } = await supabase.rpc('snopark_report_build', { p_report: reportId, p_sold: sold as unknown as Json })
  if (error) throw error
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('snopark', { body })
  if (error) {
    const ctx = (error as { context?: Response }).context
    let msg = error.message
    try { const j = ctx ? await ctx.json() : null; if (j?.error) msg = j.error } catch { /* keep the message */ }
    throw new Error(msg)
  }
  return data as T
}

export const makeExcel = (reportId: string) => invoke<{ file_name: string }>({ action: 'excel', report_id: reportId })
/** The printable copy of the State's form (Dana, Nov 10: Cat prints it for the envelope). */
export const makePrint = (reportId: string) => invoke<{ file_name: string; link_id: string; storage_path: string }>({ action: 'print', report_id: reportId })
/** The packet filed in VMS: the form first, then the book-cover photos in the order they were added. */
export const makePacket = (reportId: string) => invoke<{ file_name: string; link_id: string; pictures: number; skipped: string[] }>({ action: 'packet', report_id: reportId })
/** Season end: LS's sales against everything reported; VMS emails Dana itself when they are off. */
export const seasonCheck = (seasonId: string) => invoke<{ check: SeasonCheck }>({ action: 'season_check', season_id: seasonId })

export async function markMailed(reportId: string, on: string, tracking: string | null): Promise<void> {
  const { error } = await supabase.rpc('snopark_report_mailed', { p_report: reportId, p_on: on, p_tracking: tracking })
  if (error) throw error
}

/** The scan of the sold passes, filed under the vendor in the Sno-Park folder and tied to the report. */
export async function uploadScan(report: SnoparkReport, vendorId: string, raw: File, userId: string): Promise<VendorLink> {
  const file = await photoForUpload(raw)
  const storage_path = await uploadVendorFile(report.organization_id, vendorId, file)
  const today = new Date().toISOString().slice(0, 10)
  const link = await addVendorLink({
    organization_id: report.organization_id, vendor_id: vendorId, kind: 'snopark_scan', label: file.name.replace(/\.[a-z0-9]{2,5}$/i, ''), storage_path, file_name: file.name, file_size: file.size, mime_type: file.type || null,
    received_at: today, doc_year: Number(today.slice(0, 4)), source: 'upload', created_by: userId, notes: 'Book cover (or scan of the sold passes) for the Sno-Park report; goes into the packet after the form',
  })
  const { error } = await supabase.from('snopark_reports').update({ scan_link_ids: [...report.scan_link_ids, link.id] }).eq('id', report.id)
  if (error) throw error
  return link
}

export async function lsSold(seasonId: string, through?: string): Promise<{ day: number; season: number }> {
  const { data, error } = await supabase.rpc('snopark_ls_sold', { p_season: seasonId, p_through: through ?? new Date().toISOString().slice(0, 10) })
  if (error) throw error
  const out = { day: 0, season: 0 }
  for (const r of data ?? []) out[r.kind] = r.qty
  return out
}

/** The State's Report of Operations form for this season (they send a new one every year), filed under the vendor. */
export async function uploadSeasonForm(season: SnoparkSeason, vendorId: string, file: File, userId: string): Promise<VendorLink> {
  if (!/\.xlsx$/i.test(file.name)) throw new Error('The State\'s form is an Excel file (.xlsx)')
  const storage_path = await uploadVendorFile(season.organization_id, vendorId, file)
  const today = new Date().toISOString().slice(0, 10)
  const link = await addVendorLink({
    organization_id: season.organization_id, vendor_id: vendorId, kind: 'snopark_form', label: file.name.replace(/\.xlsx$/i, ''), storage_path, file_name: file.name, file_size: file.size, mime_type: file.type || null,
    received_at: today, doc_year: Number(season.label.slice(0, 4)), season_label: season.label, source: 'upload', created_by: userId, notes: `The State's Sno-Park Report of Operations form for ${season.label}; VMS fills it for each report`,
  })
  const { error } = await supabase.from('snopark_seasons').update({ form_link_id: link.id }).eq('id', season.id)
  if (error) throw error
  return link
}

// ---- receiving a box (Dana, Nov 10) -----------------------------------------------------------------------------
export interface ShipmentView { shipment: SnoparkShipment; season: SnoparkSeason; books: SnoparkBook[]; sheetFile: VendorLink | null; vendor: { id: string; name: string } | null; order: { id: string; po_number: string | null; order_date: string | null; description: string | null } | null }

export async function startShipment(seasonId: string, receivedOn: string, orderId: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('snopark_shipment_start', { p_season: seasonId, p_received: receivedOn, p_order: orderId })
  if (error) throw error
  return data
}

export async function getShipment(id: string): Promise<ShipmentView | null> {
  const { data: shipment, error } = await supabase.from('snopark_shipments').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  if (!shipment) return null
  const [season, books, sheetFile, order] = await Promise.all([
    supabase.from('snopark_seasons').select('*').eq('id', shipment.season_id).single(),
    supabase.from('snopark_books').select('*').eq('shipment_id', id).order('kind').order('first_permit'),
    shipment.sheet_link_id ? supabase.from('vendor_links').select('*').eq('id', shipment.sheet_link_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    shipment.order_id ? supabase.from('orders').select('id, po_number, order_date, description').eq('id', shipment.order_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ])
  if (season.error) throw season.error
  if (books.error) throw books.error
  const vendor = season.data.vendor_id ? (await supabase.from('vendors').select('id, name').eq('id', season.data.vendor_id).maybeSingle()).data : null
  return { shipment, season: season.data, books: books.data ?? [], sheetFile: sheetFile.data ?? null, vendor, order: order.data ?? null }
}

/** The State's sheet: filed under the vendor, then read by Claude. */
export async function uploadSheet(shipment: SnoparkShipment, vendorId: string, raw: File, userId: string): Promise<{ link: VendorLink; sheet: Sheet }> {
  const file = await photoForUpload(raw)
  const storage_path = await uploadVendorFile(shipment.organization_id, vendorId, file)
  const link = await addVendorLink({
    organization_id: shipment.organization_id, vendor_id: vendorId, kind: 'snopark_sheet', label: `State shipment sheet ${shipment.received_on}`, storage_path, file_name: file.name, file_size: file.size, mime_type: file.type || null,
    received_at: shipment.received_on, doc_year: Number(shipment.received_on.slice(0, 4)), doc_date: shipment.received_on, order_id: shipment.order_id, source: 'upload', created_by: userId,
    notes: "The State's Vendor Permit Request Form (OHV 145SP) that came in the box: their verification of the permits issued. Read by VMS for the receiving check.",
  })
  const r = await invoke<{ sheet: Sheet }>({ action: 'read_sheet', shipment_id: shipment.id, link_id: link.id })
  return { link, sheet: r.sheet }
}

export async function confirmSheet(shipmentId: string, sheet: Sheet): Promise<void> {
  const { error } = await supabase.rpc('snopark_shipment_sheet', { p_shipment: shipmentId, p_sheet: sheet as unknown as Json, p_link: null, p_confirmed: true })
  if (error) throw error
}

export async function saveShipmentBooks(shipmentId: string, books: { kind: 'day' | 'season'; book_number: string; first_permit: number; last_permit: number }[]): Promise<number> {
  const { data, error } = await supabase.rpc('snopark_shipment_books', { p_shipment: shipmentId, p_books: books as unknown as Json })
  if (error) throw error
  return data
}

export async function checkShipment(shipmentId: string): Promise<Difference[]> {
  const { data, error } = await supabase.rpc('snopark_shipment_check', { p_shipment: shipmentId })
  if (error) throw error
  return (data ?? []) as unknown as Difference[]
}

export async function flagShipment(shipmentId: string): Promise<string> {
  const { data, error } = await supabase.rpc('snopark_shipment_flag', { p_shipment: shipmentId })
  if (error) throw error
  return data
}

export async function acceptShipment(shipmentId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('snopark_shipment_accept', { p_shipment: shipmentId, p_note: note })
  if (error) throw error
}

/** A balanced box into Lightspeed: the PO, checked in, and the dated note on each permit item. */
export const receiveInLs = (shipmentId: string) => invoke<{ ls_order_id: string; po: string; note: string; stock_ok: boolean; problems: string[]; already?: boolean }>({ action: 'receive_ls', shipment_id: shipmentId })

export async function updateBookNumbers(bookId: string, bookNumber: string, first: number, last: number): Promise<void> {
  const { error } = await supabase.rpc('snopark_book_update', { p_book: bookId, p_book_number: bookNumber, p_first: first, p_last: last })
  if (error) throw error
}

/** The box was entered in Lightspeed by hand before VMS received it: recorded without a second LS PO. */
export async function enteredByHand(shipmentId: string, note: string | null): Promise<void> {
  const { error } = await supabase.rpc('snopark_shipment_entered_by_hand', { p_shipment: shipmentId, p_note: note })
  if (error) throw error
}

/** The State's orders this season, for the receiving picker (newest first). */
export async function seasonOrders(vendorId: string, seasonLabel: string): Promise<{ id: string; po_number: string | null; order_date: string | null; description: string | null; status: string }[]> {
  const { data, error } = await supabase.from('orders').select('id, po_number, order_date, description, status').eq('vendor_id', vendorId).gte('order_date', `${seasonLabel.slice(0, 4)}-07-01`).order('order_date', { ascending: false }).limit(20)
  if (error) throw error
  return data ?? []
}
