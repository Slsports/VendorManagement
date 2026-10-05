import { supabase } from '@/lib/supabase'
import type { BillingRoute, Json, Vendor, VendorBillingRoute, VendorEmail, VendorOrderWindow, RepGroup, PaymentTerms, Note, ReviewItem, TablesInsert, TablesUpdate } from '@/types'

export interface VendorListRow extends Vendor {
  vendor_billing_routes: Pick<VendorBillingRoute, 'route' | 'is_default'>[]
  rep_groups: Pick<RepGroup, 'name'> | null
}

export interface VendorListFilters {
  search?: string
  route?: BillingRoute | 'none'
  needsReview?: boolean
  includeInactive?: boolean
  limit?: number
}

/** Vendors for the list page, with their billing routes and rep group. */
export async function listVendors(filters: VendorListFilters = {}): Promise<VendorListRow[]> {
  let q = supabase
    .from('vendors')
    .select('*, vendor_billing_routes(route, is_default), rep_groups(name)')
    .order('name', { ascending: true })
    .limit(filters.limit ?? 1000)
  if (!filters.includeInactive) q = q.eq('is_active', true)
  if (filters.needsReview) q = q.eq('needs_review', true)
  const s = filters.search?.trim()
  if (s) {
    const like = `%${s.replace(/[%_]/g, (c) => `\\${c}`)}%`
    q = q.or(`name.ilike.${like},lightspeed_name.ilike.${like}`)
  }
  const { data, error } = await q
  if (error) throw error
  let rows = (data ?? []) as VendorListRow[]
  if (filters.route) {
    rows = rows.filter((v) =>
      filters.route === 'none' ? v.vendor_billing_routes.length === 0 : v.vendor_billing_routes.some((r) => r.route === filters.route),
    )
  }
  return rows
}

export interface VendorDetail extends Vendor {
  vendor_billing_routes: VendorBillingRoute[]
  vendor_emails: VendorEmail[]
  vendor_order_windows: VendorOrderWindow[]
  rep_groups: RepGroup | null
  payment_terms: PaymentTerms | null
  vendor_stores: { store_id: string }[]
}

export async function getVendor(id: string): Promise<VendorDetail> {
  const { data, error } = await supabase
    .from('vendors')
    .select('*, vendor_billing_routes(*), vendor_emails(*), vendor_order_windows(*), rep_groups(*), payment_terms(*), vendor_stores(store_id)')
    .eq('id', id)
    .single()
  if (error) throw error
  return data as unknown as VendorDetail
}

export async function createVendor(input: TablesInsert<'vendors'>): Promise<Vendor> {
  const { data, error } = await supabase.from('vendors').insert(input).select('*').single()
  if (error) throw error
  await logActivity(input.organization_id, 'vendor', data.id, 'created', { name: data.name })
  return data
}

export async function updateVendor(id: string, changes: TablesUpdate<'vendors'>): Promise<Vendor> {
  const { data, error } = await supabase.from('vendors').update(changes).eq('id', id).select('*').single()
  if (error) throw error
  await logActivity(data.organization_id, 'vendor', id, 'updated', { fields: Object.keys(changes) })
  return data
}

/** Replace the vendor's billing routes. The first entry is the default unless one is flagged. */
export async function setVendorRoutes(vendorId: string, routes: { route: BillingRoute; is_default?: boolean }[]) {
  const { error: delError } = await supabase.from('vendor_billing_routes').delete().eq('vendor_id', vendorId)
  if (delError) throw delError
  if (routes.length === 0) return
  const hasDefault = routes.some((r) => r.is_default)
  const rows = routes.map((r, i) => ({ vendor_id: vendorId, route: r.route, is_default: hasDefault ? !!r.is_default : i === 0 }))
  const { error } = await supabase.from('vendor_billing_routes').insert(rows)
  if (error) throw error
}

export async function addVendorEmail(input: TablesInsert<'vendor_emails'>): Promise<VendorEmail> {
  const { data, error } = await supabase.from('vendor_emails').insert(input).select('*').single()
  if (error) throw error
  return data
}

export async function updateVendorEmail(id: string, changes: TablesUpdate<'vendor_emails'>): Promise<VendorEmail> {
  const { data, error } = await supabase.from('vendor_emails').update(changes).eq('id', id).select('*').single()
  if (error) throw error
  return data
}

export async function deleteVendorEmail(id: string) {
  const { error } = await supabase.from('vendor_emails').delete().eq('id', id)
  if (error) throw error
}

export async function saveOrderWindow(input: TablesInsert<'vendor_order_windows'> & { id?: string }): Promise<VendorOrderWindow> {
  const { data, error } = await supabase.from('vendor_order_windows').upsert(input).select('*').single()
  if (error) throw error
  return data
}

export async function deleteOrderWindow(id: string) {
  const { error } = await supabase.from('vendor_order_windows').delete().eq('id', id)
  if (error) throw error
}

export async function listRepGroups(organizationId: string): Promise<RepGroup[]> {
  const { data, error } = await supabase.from('rep_groups').select('*').eq('organization_id', organizationId).eq('is_active', true).order('name')
  if (error) throw error
  return data ?? []
}

export async function listPaymentTerms(organizationId: string): Promise<PaymentTerms[]> {
  const { data, error } = await supabase.from('payment_terms').select('*').eq('organization_id', organizationId).eq('is_active', true).order('sort_order')
  if (error) throw error
  return data ?? []
}

// ---- notes ----
export interface NoteWithAuthor extends Note {
  profiles: { full_name: string; email: string } | null
}

export async function listNotes(entityType: string, entityId: string): Promise<NoteWithAuthor[]> {
  const { data, error } = await supabase
    .from('notes')
    .select('*, profiles:created_by(full_name, email)')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as NoteWithAuthor[]
}

export async function addNote(input: { organization_id: string; entity_type: string; entity_id: string; body: string; created_by: string }): Promise<Note> {
  const { data, error } = await supabase.from('notes').insert(input).select('*').single()
  if (error) throw error
  return data
}

// ---- review queue ----
export async function listReviewItems(organizationId: string, status: ReviewItem['status'] = 'pending'): Promise<ReviewItem[]> {
  const { data, error } = await supabase
    .from('review_items')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('status', status)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function resolveReviewItem(id: string, status: 'accepted' | 'rejected', resolvedBy: string, note?: string): Promise<ReviewItem> {
  const { data, error } = await supabase
    .from('review_items')
    .update({ status, resolved_by: resolvedBy, resolved_at: new Date().toISOString(), resolution_note: note ?? null })
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return data
}

// ---- activity ----
export async function logActivity(organizationId: string, entityType: string, entityId: string | null, action: string, details: Json = {}) {
  const { data: auth } = await supabase.auth.getUser()
  const { error } = await supabase.from('activity_log').insert({
    organization_id: organizationId,
    entity_type: entityType,
    entity_id: entityId,
    action,
    details,
    actor_id: auth.user?.id ?? null,
  })
  if (error) console.warn('activity log failed', error.message)
}
