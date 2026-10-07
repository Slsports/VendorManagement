import { supabase } from '@/lib/supabase'
import type { BillingRoute, Line, RepGroup, ShowAppearance, TablesInsert, TablesUpdate, Vendor, VendorLink } from '@/types'

// ---- lines (what reps carry, what shows list; not vendors) ----
export interface LineRow extends Line {
  rep_group: Pick<RepGroup, 'id' | 'name'> | null
  vendor: Pick<Vendor, 'id' | 'name' | 'is_active'> | null
  show_appearances: Pick<ShowAppearance, 'show_code' | 'show_label' | 'booth' | 'exhibitor' | 'is_new'>[]
}

const LINE_SELECT = '*, rep_group:rep_groups(id, name), vendor:vendors(id, name, is_active), show_appearances(show_code, show_label, booth, exhibitor, is_new)'

export async function listLines(organizationId: string): Promise<LineRow[]> {
  const { data, error } = await supabase.from('vendor_directory').select(LINE_SELECT).eq('organization_id', organizationId).order('name').returns<LineRow[]>()
  if (error) throw error
  return data ?? []
}

export async function listLinesForRepGroup(repGroupId: string): Promise<LineRow[]> {
  const { data, error } = await supabase.from('vendor_directory').select(LINE_SELECT).eq('rep_group_id', repGroupId).order('name').returns<LineRow[]>()
  if (error) throw error
  return data ?? []
}

/** Turn a catalog-only line into a vendor record (rep group, route, catalog link carried over). */
export async function promoteLine(lineId: string, route?: BillingRoute | null): Promise<string> {
  const { data, error } = await supabase.rpc('promote_line_to_vendor', { p_line: lineId, p_route: route ?? null })
  if (error) throw error
  return data
}

export async function updateLine(id: string, changes: TablesUpdate<'vendor_directory'>): Promise<void> {
  const { error } = await supabase.from('vendor_directory').update(changes).eq('id', id)
  if (error) throw error
}

// ---- rep groups ----
export interface RepGroupRow extends RepGroup {
  vendor_count: number
  line_count: number
}

export async function listRepGroupsWithCounts(organizationId: string): Promise<RepGroupRow[]> {
  const { data, error } = await supabase
    .from('rep_groups')
    .select('*, vendors(count), vendor_directory(count)')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .order('name')
  if (error) throw error
  return (data ?? []).map((g) => {
    const { vendors, vendor_directory, ...rest } = g as RepGroup & { vendors: { count: number }[]; vendor_directory: { count: number }[] }
    const vendorCount = vendors?.[0]?.count ?? 0
    // lines that are also vendors are counted once, as vendors
    return { ...rest, vendor_count: vendorCount, line_count: Math.max(0, (vendor_directory?.[0]?.count ?? 0)) }
  })
}

export interface RepGroupDetail extends RepGroup {
  vendors: (Pick<Vendor, 'id' | 'name' | 'is_active' | 'do_not_order' | 'wwd_zero_upcharge'> & { vendor_billing_routes: { route: BillingRoute; is_default: boolean }[] })[]
  lines: LineRow[]
}

export async function getRepGroup(id: string): Promise<RepGroupDetail> {
  const [{ data: group, error: e1 }, { data: vendors, error: e2 }, lines] = await Promise.all([
    supabase.from('rep_groups').select('*').eq('id', id).single(),
    supabase.from('vendors').select('id, name, is_active, do_not_order, wwd_zero_upcharge, vendor_billing_routes(route, is_default)').eq('rep_group_id', id).eq('is_active', true).order('name'),
    listLinesForRepGroup(id),
  ])
  if (e1) throw e1
  if (e2) throw e2
  return { ...group, vendors: vendors ?? [], lines: lines.filter((l) => !l.matched_vendor_id) }
}

export async function updateRepGroup(id: string, changes: TablesUpdate<'rep_groups'>): Promise<void> {
  const { error } = await supabase.from('rep_groups').update(changes).eq('id', id)
  if (error) throw error
}

export async function createRepGroup(input: TablesInsert<'rep_groups'>): Promise<RepGroup> {
  const { data, error } = await supabase.from('rep_groups').insert(input).select('*').single()
  if (error) throw error
  return data
}

/** For the vendor page: the rep group's other lines (vendors and catalog-only), a handful at a time. */
export async function listRepGroupSiblings(repGroupId: string, vendorId: string): Promise<{ vendors: Pick<Vendor, 'id' | 'name'>[]; lines: Pick<Line, 'id' | 'name' | 'catalog_url'>[] }> {
  const [{ data: vendors, error: e1 }, { data: lines, error: e2 }] = await Promise.all([
    supabase.from('vendors').select('id, name').eq('rep_group_id', repGroupId).eq('is_active', true).neq('id', vendorId).order('name'),
    supabase.from('vendor_directory').select('id, name, catalog_url').eq('rep_group_id', repGroupId).is('matched_vendor_id', null).order('name'),
  ])
  if (e1) throw e1
  if (e2) throw e2
  return { vendors: vendors ?? [], lines: lines ?? [] }
}

// ---- show attendance ----
export interface VendorShow extends ShowAppearance {
  /** Other lines in the same booth at that show (the rep's or parent's other lines). */
  booth_mates: { name: string; vendor_id: string | null; line_id: string }[]
}

export async function listVendorShows(vendorId: string): Promise<VendorShow[]> {
  const { data, error } = await supabase.from('show_appearances').select('*').eq('vendor_id', vendorId).order('show_date', { ascending: false })
  if (error) throw error
  const rows = data ?? []
  if (rows.length === 0) return []
  const codes = [...new Set(rows.map((r) => r.show_code))]
  const booths = [...new Set(rows.map((r) => r.booth).filter((b): b is string => !!b))]
  const { data: mates, error: e2 } = booths.length
    ? await supabase.from('show_appearances').select('show_code, booth, vendor_id, line_id, vendor_directory(name)').in('show_code', codes).in('booth', booths).neq('vendor_id', vendorId)
    : { data: [], error: null }
  if (e2) throw e2
  return rows.map((r) => ({
    ...r,
    booth_mates: (mates ?? [])
      .filter((m) => m.show_code === r.show_code && m.booth === r.booth && m.line_id !== r.line_id)
      .map((m) => ({ name: (m.vendor_directory as { name: string } | null)?.name ?? '?', vendor_id: m.vendor_id, line_id: m.line_id }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }))
}

// ---- links & files ----
const BUCKET = 'vendor-files'

export type VendorLinkRow = VendorLink & { email: { thread_id: string } | null }

/** A vendor's files and links, newest first, with the email conversation each one came from. */
export async function listVendorLinks(vendorId: string): Promise<VendorLinkRow[]> {
  const { data, error } = await supabase.from('vendor_links').select('*, email:emails(thread_id)').eq('vendor_id', vendorId)
    .order('received_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as VendorLinkRow[]
}

export async function addVendorLink(input: TablesInsert<'vendor_links'>): Promise<VendorLink> {
  const { data, error } = await supabase.from('vendor_links').insert(input).select('*').single()
  if (error) throw error
  return data
}

/** Upload a file to the private bucket under <org>/<vendor>/ and return its storage path. */
export async function uploadVendorFile(organizationId: string, vendorId: string, file: File): Promise<string> {
  const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_')
  const path = `${organizationId}/${vendorId}/${crypto.randomUUID()}-${safe}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || undefined, upsert: false })
  if (error) throw error
  return path
}

export async function signedFileUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60 * 60)
  if (error) throw error
  return data.signedUrl
}

export async function deleteVendorLink(link: VendorLink): Promise<void> {
  if (link.storage_path) {
    const { error } = await supabase.storage.from(BUCKET).remove([link.storage_path])
    if (error) throw error
  }
  const { error } = await supabase.from('vendor_links').delete().eq('id', link.id)
  if (error) throw error
}
