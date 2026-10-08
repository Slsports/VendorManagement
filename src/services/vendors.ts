import { supabase } from '@/lib/supabase'
import type { BillingRoute, Json, Vendor, VendorBillingRoute, VendorEmail, VendorMerge, VendorOrderWindow, RepGroup, RepGroupContact, PaymentTerms, Note, ReviewItem, TablesInsert, TablesUpdate } from '@/types'

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
    .is('merged_into_id', null)
    .limit(filters.limit ?? 5000)
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
  rep_groups: (RepGroup & { rep_group_contacts: RepGroupContact[] }) | null
  payment_terms: PaymentTerms | null
  vendor_stores: { store_id: string }[]
}

export async function getVendor(id: string): Promise<VendorDetail> {
  const { data, error } = await supabase
    .from('vendors')
    .select('*, vendor_billing_routes(*), vendor_emails!vendor_emails_vendor_id_fkey(*), vendor_order_windows(*), rep_groups(*, rep_group_contacts(*)), payment_terms(*), vendor_stores(store_id)')
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

/** Delete a vendor that never belonged (not one we bought from); its names are kept out of future imports. */
export async function deleteVendor(vendorId: string, note?: string): Promise<void> {
  const { error } = await supabase.rpc('delete_vendor', { p_vendor: vendorId, p_note: note ?? null })
  if (error) throw error
}

export async function listVendorExclusions(organizationId: string) {
  const { data, error } = await supabase.from('vendor_exclusions').select('id, name, created_at').eq('organization_id', organizationId).order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/** Let a deleted name be added or imported again (admins). */
export async function allowVendorName(exclusionId: string): Promise<void> {
  const { error } = await supabase.from('vendor_exclusions').delete().eq('id', exclusionId)
  if (error) throw error
}

/** Set (or keep) who orders from a vendor; closes its "who orders from this vendor" review. */
export async function setVendorAssignee(vendorId: string, profileId: string | null): Promise<void> {
  const { error } = await supabase.rpc('set_vendor_assignee', { p_vendor: vendorId, p_profile: profileId })
  if (error) throw error
}

export async function resolveReviewItem(id: string, status: 'accepted' | 'rejected', note?: string): Promise<void> {
  const { error } = await supabase.rpc('resolve_review_item', { p_item: id, p_status: status, p_note: note ?? null })
  if (error) throw error
}

/** Review items for the queue page, with the vendor names they talk about. */
export interface ReviewItemRow extends ReviewItem {
  vendor: Pick<Vendor, 'id' | 'name' | 'lightspeed_name' | 'aliases' | 'is_active'> | null
  other: Pick<Vendor, 'id' | 'name' | 'lightspeed_name' | 'aliases' | 'is_active'> | null
}

export async function listReviewQueue(organizationId: string): Promise<ReviewItemRow[]> {
  const items = await listReviewItems(organizationId)
  const ids = new Set<string>()
  for (const it of items) {
    if (it.entity_type === 'vendor' && it.entity_id) ids.add(it.entity_id)
    const other = (it.details as { other_vendor_id?: string } | null)?.other_vendor_id
    if (other) ids.add(other)
  }
  if (ids.size === 0) return items.map((it) => ({ ...it, vendor: null, other: null }))
  const { data, error } = await supabase.from('vendors').select('id, name, lightspeed_name, aliases, is_active').in('id', [...ids])
  if (error) throw error
  const byId = new Map((data ?? []).map((v) => [v.id, v]))
  return items.map((it) => ({
    ...it,
    vendor: it.entity_type === 'vendor' && it.entity_id ? (byId.get(it.entity_id) ?? null) : null,
    other: byId.get((it.details as { other_vendor_id?: string } | null)?.other_vendor_id ?? '') ?? null,
  }))
}

// ---- merge / split (duplicate review) ----
/** Fold `removeId` into `keepId`. Optionally state the usual billing route of the result. */
export async function mergeVendors(keepId: string, removeId: string, route?: BillingRoute | null): Promise<string> {
  const { data, error } = await supabase.rpc('merge_vendors', { p_keep: keepId, p_remove: removeId, p_route: route ?? null })
  if (error) throw error
  return data
}

/** Split one Lightspeed name back out of a vendor into its own record. */
export async function unmergeVendor(vendorId: string, lightspeedName: string, route?: BillingRoute | null): Promise<string> {
  const { data, error } = await supabase.rpc('unmerge_vendor', { p_vendor: vendorId, p_lightspeed_name: lightspeedName, p_route: route ?? null })
  if (error) throw error
  return data
}

/** Dana looked at an import-time merge and it is one vendor. */
export async function confirmVendorMerge(vendorId: string, route?: BillingRoute | null): Promise<void> {
  const { error } = await supabase.rpc('confirm_vendor_merge', { p_vendor: vendorId, p_route: route ?? null })
  if (error) throw error
}

/** Apply a proposed Lightspeed-name clean-up (review kind vendor_rename), optionally with an edited name. */
export async function applyVendorRename(itemId: string, newName?: string | null, repGroupId?: string | null): Promise<void> {
  const { error } = await supabase.rpc('apply_vendor_rename', { p_item: itemId, p_new_name: newName ?? null, p_rep_group_id: repGroupId ?? null })
  if (error) throw error
}

// ---- Lightspeed merge report ----
export async function listVendorMerges(organizationId: string): Promise<VendorMerge[]> {
  const { data, error } = await supabase
    .from('vendor_merges')
    .select('*')
    .eq('organization_id', organizationId)
    .order('kept_name', { ascending: true })
    .order('merged_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function setMergeDoneInLightspeed(id: string, done: boolean, userId: string): Promise<void> {
  const { error } = await supabase
    .from('vendor_merges')
    .update(done ? { ls_done_at: new Date().toISOString(), ls_done_by: userId } : { ls_done_at: null, ls_done_by: null })
    .eq('id', id)
  if (error) throw error
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
