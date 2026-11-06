// Sno-Park passes (Dana, Nov 5-6, 2026): the season, its books and its monthly reports.
import { supabase } from '@/lib/supabase'
import { addVendorLink, uploadVendorFile } from '@/services/lines'
import type { Json, SnoparkBook, SnoparkReport, SnoparkReportRow, SnoparkSeason, VendorLink } from '@/types'

export interface SeasonView { season: SnoparkSeason; books: SnoparkBook[]; reports: SnoparkReport[]; vendor: { id: string; name: string } | null }

/** The open season, else the latest one; null when none has been opened. */
export async function getSeason(organizationId: string, seasonId?: string | null): Promise<SeasonView | null> {
  let q = supabase.from('snopark_seasons').select('*').eq('organization_id', organizationId)
  q = seasonId ? q.eq('id', seasonId) : q.order('status', { ascending: false }).order('label', { ascending: false })
  const { data: seasons, error } = await q.limit(1)
  if (error) throw error
  const season = seasons?.[0]
  if (!season) return null
  const [books, reports, vendor] = await Promise.all([
    supabase.from('snopark_books').select('*').eq('season_id', season.id).order('kind').order('first_permit'),
    supabase.from('snopark_reports').select('*').eq('season_id', season.id).order('seq'),
    season.vendor_id ? supabase.from('vendors').select('id, name').eq('id', season.vendor_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ])
  if (books.error) throw books.error
  if (reports.error) throw reports.error
  return { season, books: books.data ?? [], reports: reports.data ?? [], vendor: vendor.data ?? null }
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

export interface ReportView { report: SnoparkReport; season: SnoparkSeason; rows: SnoparkReportRow[]; books: SnoparkBook[]; file: VendorLink | null; scans: VendorLink[]; vendor: { id: string; name: string } | null }

export async function getReport(id: string): Promise<ReportView | null> {
  const { data: report, error } = await supabase.from('snopark_reports').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  if (!report) return null
  const [season, rows, books, file, scans] = await Promise.all([
    supabase.from('snopark_seasons').select('*').eq('id', report.season_id).single(),
    supabase.from('snopark_report_rows').select('*').eq('report_id', id).order('sort'),
    supabase.from('snopark_books').select('*').eq('season_id', report.season_id).order('kind').order('first_permit'),
    report.file_link_id ? supabase.from('vendor_links').select('*').eq('id', report.file_link_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    report.scan_link_ids.length ? supabase.from('vendor_links').select('*').in('id', report.scan_link_ids).order('created_at') : Promise.resolve({ data: [], error: null }),
  ])
  if (season.error) throw season.error
  if (rows.error) throw rows.error
  if (books.error) throw books.error
  const vendor = season.data.vendor_id ? (await supabase.from('vendors').select('id, name').eq('id', season.data.vendor_id).maybeSingle()).data : null
  return { report, season: season.data, rows: rows.data ?? [], books: books.data ?? [], file: file.data ?? null, scans: scans.data ?? [], vendor }
}

/** The books picked as sold: to_permit is the last permit sold (left out = the whole book). */
export async function buildReport(reportId: string, sold: { book_id: string; to_permit?: number }[]): Promise<void> {
  const { error } = await supabase.rpc('snopark_report_build', { p_report: reportId, p_sold: sold as unknown as Json })
  if (error) throw error
}

export async function makeExcel(reportId: string): Promise<{ file_name: string }> {
  const { data, error } = await supabase.functions.invoke('snopark', { body: { action: 'excel', report_id: reportId } })
  if (error) {
    const ctx = (error as { context?: Response }).context
    let msg = error.message
    try { const j = ctx ? await ctx.json() : null; if (j?.error) msg = j.error } catch { /* keep the message */ }
    throw new Error(msg)
  }
  return data as { file_name: string }
}

export async function markMailed(reportId: string, on: string, tracking: string | null): Promise<void> {
  const { error } = await supabase.rpc('snopark_report_mailed', { p_report: reportId, p_on: on, p_tracking: tracking })
  if (error) throw error
}

/** The scan of the sold passes, filed under the vendor in the Sno-Park folder and tied to the report. */
export async function uploadScan(report: SnoparkReport, vendorId: string, file: File, userId: string): Promise<VendorLink> {
  const storage_path = await uploadVendorFile(report.organization_id, vendorId, file)
  const today = new Date().toISOString().slice(0, 10)
  const link = await addVendorLink({
    organization_id: report.organization_id, vendor_id: vendorId, kind: 'snopark_scan', label: file.name.replace(/\.[a-z0-9]{2,5}$/i, ''), storage_path, file_name: file.name, file_size: file.size, mime_type: file.type || null,
    received_at: today, doc_year: Number(today.slice(0, 4)), source: 'upload', created_by: userId, notes: 'Scan of the sold passes for the Sno-Park report',
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
