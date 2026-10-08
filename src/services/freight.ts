import { supabase } from '@/lib/supabase'
import type { Carrier, FreightBill, FreightBillLine, Order, TablesInsert } from '@/types'

export interface FreightBillRow extends FreightBill {
  carriers: Pick<Carrier, 'id' | 'name' | 'mode' | 'website'> | null
  freight_bill_lines: (Pick<FreightBillLine, 'id' | 'shipper_name' | 'amount' | 'confirmed'>)[]
}

export interface FreightBillDetail extends FreightBill {
  carriers: Carrier | null
  emails: { id: string; thread_id: string; subject: string | null } | null
  freight_bill_lines: (FreightBillLine & {
    vendors: { id: string; name: string } | null
    orders: Pick<Order, 'id' | 'order_date' | 'po_number' | 'est_cost' | 'final_cost' | 'description'> | null
  })[]
}

export async function listCarriers(organizationId: string): Promise<Carrier[]> {
  const { data, error } = await supabase.from('carriers').select('*').eq('organization_id', organizationId).eq('is_active', true).order('name')
  if (error) throw error
  return data ?? []
}

export async function createCarrier(input: TablesInsert<'carriers'>): Promise<Carrier> {
  const { data, error } = await supabase.from('carriers').insert(input).select('*').single()
  if (error) throw error
  return data
}

export type FreightFilter = 'open' | 'done' | 'all'

export async function listFreightBills(organizationId: string, filter: FreightFilter): Promise<FreightBillRow[]> {
  let q = supabase.from('freight_bills')
    .select('*, carriers(id, name, mode, website), freight_bill_lines(id, shipper_name, amount, confirmed)')
    .eq('organization_id', organizationId)
  if (filter === 'open') q = q.neq('status', 'done')
  else if (filter === 'done') q = q.eq('status', 'done')
  const { data, error } = await q.order('invoice_date', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(300)
  if (error) throw error
  return (data ?? []) as unknown as FreightBillRow[]
}

export async function getFreightBill(id: string): Promise<FreightBillDetail> {
  const { data, error } = await supabase.from('freight_bills')
    .select('*, carriers(*), emails(id, thread_id, subject), freight_bill_lines(*, vendors:vendor_id(id, name), orders(id, order_date, po_number, est_cost, final_cost, description))')
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
