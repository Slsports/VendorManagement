import { supabase } from '@/lib/supabase'
import { billcomRows, type BillcomRow } from '@/lib/billcom'

export interface BillcomMatch {
  carrier_id: string | null; carrier: string | null; bill_id: string | null; bill: string | null; bill_paid: boolean | null
  vendor_id: string | null; vendor: string | null; order_id: string | null; order: string | null; order_paid: boolean | null; already: boolean
}

/** Read the Bill.com Payments export (Excel or CSV) in the browser. */
export async function readBillcomFile(file: File): Promise<BillcomRow[]> {
  const XLSX = await import('xlsx')
  const book = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  const sheet = book.Sheets[book.SheetNames[0]!]!
  return billcomRows(XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, blankrows: false, defval: '' }))
}

export async function previewBillcom(rows: BillcomRow[]): Promise<BillcomMatch[]> {
  const out: BillcomMatch[] = []
  for (let i = 0; i < rows.length; i += 200) {
    const { data, error } = await supabase.rpc('billcom_preview', { p_rows: rows.slice(i, i + 200) as unknown as never })
    if (error) throw error
    out.push(...((data ?? []) as BillcomMatch[]))
  }
  return out
}

export async function importBillcom(rows: BillcomRow[]): Promise<number> {
  let n = 0
  for (let i = 0; i < rows.length; i += 200) {
    const { data, error } = await supabase.rpc('billcom_import', { p_rows: rows.slice(i, i + 200) as unknown as never })
    if (error) throw error
    n += (data as number) ?? 0
  }
  return n
}

export interface PaymentRow { id: string; payee: string; process_date: string | null; amount: number | null; invoice_number: string | null; method: string | null; confirmation: string | null; status: string | null; freight_bill_id: string | null; order_id: string | null }

/** A vendor's (or billing company's) payment history, newest first. */
export async function listPayments(f: { vendorId?: string; carrierId?: string; organizationId?: string }, limit = 100): Promise<PaymentRow[]> {
  let q = supabase.from('vendor_payments').select('id, payee, process_date, amount, invoice_number, method, confirmation, status, freight_bill_id, order_id')
  if (f.vendorId) q = q.eq('vendor_id', f.vendorId)
  if (f.carrierId) q = q.eq('carrier_id', f.carrierId)
  if (f.organizationId) q = q.eq('organization_id', f.organizationId)
  const { data, error } = await q.order('process_date', { ascending: false, nullsFirst: false }).limit(limit)
  if (error) throw error
  return (data ?? []) as PaymentRow[]
}
