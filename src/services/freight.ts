import { supabase } from '@/lib/supabase'
import { TEST_LOGIN_PATTERN } from '@/services/reviews'
import type { Carrier, FreightBill, FreightBillLine, Order, TablesInsert, TablesUpdate } from '@/types'

export interface FreightBillRow extends FreightBill {
  carriers: Pick<Carrier, 'id' | 'name' | 'mode' | 'website' | 'ups_account'> | null
  freight_bill_lines: (Pick<FreightBillLine, 'id' | 'shipper_name' | 'amount' | 'confirmed'>)[]
}

export interface FreightBillDetail extends FreightBill {
  carriers: Carrier | null
  emails: { id: string; thread_id: string; subject: string | null } | null
  /** Where the payment was read from: a carrier receipt, or our own "it's paid" email. */
  paid_email: { id: string; thread_id: string; subject: string | null; direction: string } | null
  freight_bill_lines: (FreightBillLine & {
    vendors: { id: string; name: string } | null
    orders: Pick<Order, 'id' | 'order_date' | 'po_number' | 'est_cost' | 'final_cost' | 'description'> | null
  })[]
}

/** Active carriers; with `includeInactive`, retired ones too (after the active ones). */
export async function listCarriers(organizationId: string, includeInactive = false): Promise<Carrier[]> {
  let q = supabase.from('carriers').select('*').eq('organization_id', organizationId)
  if (!includeInactive) q = q.eq('is_active', true)
  const { data, error } = await q.order('is_active', { ascending: false }).order('name')
  if (error) throw error
  return data ?? []
}

/** Add a carrier, then claim the mail already in VMS from its email domains. */
export async function createCarrier(input: TablesInsert<'carriers'>): Promise<Carrier> {
  const { data, error } = await supabase.from('carriers').insert(input).select('*').single()
  if (error) throw error
  await claimCarrierMail(data.id)
  return data
}

/** Edit a carrier; new email domains claim their mail too. Only one carrier is the default for UPS (parcel). */
export async function updateCarrier(id: string, patch: TablesUpdate<'carriers'>): Promise<Carrier> {
  if (patch.is_default_parcel) {
    const { error: e0 } = await supabase.from('carriers').update({ is_default_parcel: false }).eq('is_default_parcel', true).neq('id', id)
    if (e0) throw e0
  }
  const { data, error } = await supabase.from('carriers').update(patch).eq('id', id).select('*').single()
  if (error) throw error
  await claimCarrierMail(id)
  return data
}

async function claimCarrierMail(id: string): Promise<number> {
  const { data, error } = await supabase.rpc('carrier_claim_mail', { p_carrier: id })
  if (error) throw error
  return data ?? 0
}

/** Who can get a carrier's mail: everyone active but the test login. */
export async function listCarrierOwners(organizationId: string): Promise<{ id: string; full_name: string }[]> {
  const { data, error } = await supabase.from('profiles').select('id, full_name').eq('organization_id', organizationId).eq('is_active', true).not('email', 'ilike', TEST_LOGIN_PATTERN).order('full_name')
  if (error) throw error
  return data ?? []
}

export type FreightFilter = 'open' | 'unpaid' | 'done' | 'all'

export async function listFreightBills(organizationId: string, filter: FreightFilter, carrierId?: string | null): Promise<FreightBillRow[]> {
  let q = supabase.from('freight_bills')
    .select('*, carriers(id, name, mode, website, ups_account), freight_bill_lines(id, shipper_name, amount, confirmed)')
    .eq('organization_id', organizationId)
  if (carrierId) q = q.eq('carrier_id', carrierId)
  if (filter === 'open') q = q.neq('status', 'done')
  else if (filter === 'unpaid') q = q.is('paid_date', null).not('total', 'is', null)
  else if (filter === 'done') q = q.eq('status', 'done')
  const { data, error } = await q.order('invoice_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(300)
  if (error) throw error
  return (data ?? []) as unknown as FreightBillRow[]
}

export async function getFreightBill(id: string): Promise<FreightBillDetail> {
  const { data, error } = await supabase.from('freight_bills')
    .select('*, carriers(*), emails:emails!freight_bills_email_id_fkey(id, thread_id, subject), paid_email:emails!freight_bills_paid_email_id_fkey(id, thread_id, subject, direction), freight_bill_lines(*, vendors:vendor_id(id, name), orders(id, order_date, po_number, est_cost, final_cost, description))')
    .eq('id', id).single()
  if (error) throw error
  const bill = data as unknown as FreightBillDetail
  bill.freight_bill_lines.sort((a, b) => a.sort_order - b.sort_order)
  return bill
}

/** A vendor's orders to pick from on a freight line, newest first. */
export async function listVendorOrdersForFreight(vendorId: string) {
  const { data, error } = await supabase.from('orders').select('id, order_date, po_number, est_cost, final_cost, description, date_received')
    .eq('vendor_id', vendorId).order('order_date', { ascending: false, nullsFirst: false }).limit(25)
  if (error) throw error
  return data ?? []
}

/** Match a line to its vendor and order; confirming puts the freight cost on the order. */
export async function setFreightLine(lineId: string, vendorId: string | null, orderId: string | null, confirm: boolean): Promise<void> {
  const { error } = await supabase.rpc('freight_set_line', { p_line: lineId, p_vendor: vendorId, p_order: orderId, p_confirm: confirm })
  if (error) throw error
}

export async function addFreightLine(input: TablesInsert<'freight_bill_lines'>): Promise<void> {
  const { error } = await supabase.from('freight_bill_lines').insert(input)
  if (error) throw error
}

export async function setFreightBillStatus(id: string, status: FreightBill['status']): Promise<void> {
  const { error } = await supabase.from('freight_bills').update({ status }).eq('id', id)
  if (error) throw error
}

/** Trevor drops the bill PDF on the bill (PartnerShip sends none): saved, then read by Claude. */
export async function uploadFreightPdf(bill: Pick<FreightBill, 'id' | 'organization_id'>, file: File): Promise<void> {
  const path = `${bill.organization_id}/freight/${crypto.randomUUID()}-${file.name.replace(/[^A-Za-z0-9._-]+/g, '_')}`
  const { error } = await supabase.storage.from('vendor-files').upload(path, file, { contentType: file.type || 'application/pdf', upsert: false })
  if (error) throw error
  const { error: e2 } = await supabase.from('freight_bills').update({ storage_path: path, file_name: file.name, status: 'reading', read_note: null }).eq('id', bill.id)
  if (e2) throw e2
  await readFreightBill(bill.id)
}

export async function readFreightBill(billId: string): Promise<void> {
  const { data, error } = await supabase.functions.invoke('freight-read', { body: { bill_id: billId } })
  if (error) {
    const ctx = (error as { context?: Response }).context
    const body = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null
    throw new Error(body?.note ?? body?.error ?? (error instanceof Error ? error.message : String(error)))
  }
  if (data && data.ok === false) throw new Error(data.note ?? 'Could not read the bill')
}

/** Mark a sender as a freight carrier (Review queue). Returns how many conversations moved to freight. */
export async function setSenderCarrier(senderId: string, carrierId: string): Promise<number> {
  const { data, error } = await supabase.rpc('set_sender_carrier', { p_sender: senderId, p_carrier: carrierId })
  if (error) throw error
  return data ?? 0
}

/** Dana pays the bills: record when and how. Null clears it. */
/** "Make a freight bill" from a PDF in an email: the mail sync fetches it and Claude reads it (a minute or so). */
export async function makeFreightBillFromAttachment(attachmentId: string, carrierId: string): Promise<string> {
  const { data, error } = await supabase.rpc('make_freight_bill_from_attachment', { p_attachment: attachmentId, p_carrier: carrierId })
  if (error) throw error
  return data as string
}

/** The "which bill?" card for a freight payment. */
export async function answerFreightPayment(itemId: string, billId: string): Promise<void> {
  const { error } = await supabase.rpc('answer_freight_payment', { p_item: itemId, p_bill: billId })
  if (error) throw error
}

export async function setFreightBillPaid(id: string, paid: { paid_date: string; paid_via: FreightBill['paid_via']; paid_ref: string | null; paid_by: string } | null): Promise<void> {
  const { error } = await supabase.from('freight_bills').update(paid ? { ...paid, paid_source: 'manual' as const } : { paid_date: null, paid_via: null, paid_ref: null, paid_by: null, paid_source: null, paid_email_id: null }).eq('id', id)
  if (error) throw error
}

/** Dashboard: bills waiting to be matched (Trevor's side) and bills to pay, soonest due first. */
export async function freightForDashboard(organizationId: string) {
  const [m, p] = await Promise.all([
    supabase.from('freight_bills').select('id, invoice_number, invoice_date, total, status, carriers(name)').eq('organization_id', organizationId).in('status', ['needs_pdf', 'to_match', 'failed', 'reading']).order('invoice_date', { ascending: false, nullsFirst: false }).limit(20),
    supabase.from('freight_bills').select('id, invoice_number, invoice_date, due_date, total, status, carriers(name)').eq('organization_id', organizationId).is('paid_date', null).not('total', 'is', null).order('due_date', { ascending: true, nullsFirst: false }).limit(20),
  ])
  if (m.error) throw m.error
  if (p.error) throw p.error
  type Row = { id: string; invoice_number: string | null; invoice_date: string | null; due_date?: string | null; total: number | null; status: FreightBill['status']; carriers: { name: string } | null }
  return { toMatch: (m.data ?? []) as unknown as Row[], toPay: (p.data ?? []) as unknown as Row[] }
}

/** Settings > Mail: everyone active (but the test login), whether they also see freight, and who owns it. */
export async function listFreightWatchers(organizationId: string): Promise<{ people: { id: string; full_name: string; sees_freight: boolean }[]; owners: string[] }> {
  const [p, c] = await Promise.all([
    supabase.from('profiles').select('id, full_name, sees_freight, email').eq('organization_id', organizationId).eq('is_active', true).not('email', 'ilike', 'claude-test@%').order('full_name'),
    supabase.from('carriers').select('owner_id').eq('organization_id', organizationId).eq('is_active', true),
  ])
  if (p.error) throw p.error
  if (c.error) throw c.error
  const ownerIds = new Set((c.data ?? []).map((x) => x.owner_id).filter(Boolean))
  const people = p.data ?? []
  return {
    people: people.filter((x) => !ownerIds.has(x.id)).map(({ id, full_name, sees_freight }) => ({ id, full_name, sees_freight })),
    owners: people.filter((x) => ownerIds.has(x.id)).map((x) => x.full_name),
  }
}

export async function setSeesFreight(profileId: string, on: boolean): Promise<void> {
  const { error } = await supabase.from('profiles').update({ sees_freight: on }).eq('id', profileId)
  if (error) throw error
}


/** "File to this vendor" on a delivery receipt Claude could not match (review queue). */
export async function fileDeliveryReceipt(receiptId: string, vendorId: string): Promise<void> {
  const { error } = await supabase.rpc('file_delivery_receipt', { p_receipt: receiptId, p_vendor: vendorId })
  if (error) throw error
}
