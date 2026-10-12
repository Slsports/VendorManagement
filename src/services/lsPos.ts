import { supabase } from '@/lib/supabase'
import { orderingChanged } from '@/services/ordering'
import type { LsPo } from '@/types'
import type { Json } from '@/types/database'

// LS POs (Dana, Oct 12): Claude drafts → the orderer approves → Trevor reviews and sends to LS → LS PO number.

export interface LsPoLine {
  vid: string | null
  upc: string | null
  /** as the vendor wrote it */
  desc: string
  qty: number
  cost: number | null
  /** the LS item (System ID) when it is already in LS */
  system_id: string | null
  /** LS name and category (new items: proposed by Claude) */
  name: string
  category: string
  is_new: boolean
  note: string | null
}

export interface LsPoRow extends Omit<LsPo, 'lines'> {
  lines: LsPoLine[]
  vendor: { id: string; name: string } | null
  order: { id: string; po_number: string | null; description: string | null; order_date: string | null; store_codes: string[] } | null
  approver: { id: string; full_name: string } | null
  reviewer: { id: string; full_name: string } | null
}

export const LS_PO_STATUS: Record<LsPo['status'], { label: string; waiting: string }> = {
  drafting: { label: 'Claude is drafting it', waiting: 'Claude' },
  to_approve: { label: 'To approve', waiting: 'the person who placed the order' },
  to_review: { label: 'To review', waiting: 'the LS PO reviewer' },
  ready: { label: 'Enter in LS', waiting: 'the LS PO reviewer' },
  sent: { label: 'In LS', waiting: 'nobody' },
}

const LS_PO_SELECT = `*, vendor:vendors!ls_pos_vendor_id_fkey(id, name), order:orders!ls_pos_order_id_fkey(id, po_number, description, order_date, store_codes),
  approver:profiles!ls_pos_approver_id_fkey(id, full_name), reviewer:profiles!ls_pos_reviewer_id_fkey(id, full_name)`

export async function listOpenLsPos(organizationId: string): Promise<LsPoRow[]> {
  const { data, error } = await supabase.from('ls_pos').select(LS_PO_SELECT).eq('organization_id', organizationId).neq('status', 'sent').order('created_at')
  if (error) throw error
  return (data ?? []) as unknown as LsPoRow[]
}

export async function getLsPo(id: string): Promise<LsPoRow | null> {
  const { data, error } = await supabase.from('ls_pos').select(LS_PO_SELECT).eq('id', id).maybeSingle()
  if (error) throw error
  return data as unknown as LsPoRow | null
}

export async function getLsPoForOrder(orderId: string): Promise<LsPoRow | null> {
  const { data, error } = await supabase.from('ls_pos').select(LS_PO_SELECT).eq('order_id', orderId).maybeSingle()
  if (error) throw error
  return data as unknown as LsPoRow | null
}

/** Start a draft by hand (confirmed orders start on their own). */
export async function startLsPo(orderId: string): Promise<string> {
  const { data, error } = await supabase.rpc('ls_po_start', { p_order: orderId })
  if (error) throw error
  orderingChanged()
  return data as string
}

export async function lsPoAction(id: string, action: 'save' | 'approve' | 'send' | 'done' | 'redraft' | 'back', lines?: LsPoLine[] | null, number?: string | null): Promise<void> {
  const { error } = await supabase.rpc('ls_po_action', { p_id: id, p_action: action, p_lines: (lines ?? null) as unknown as Json, p_number: number ?? null })
  if (error) throw error
  orderingChanged()
}

const csvCell = (v: unknown) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }

/** The PO as a spreadsheet for entering in LS: one row per item. */
export function lsPoCsv(po: Pick<LsPoRow, 'lines' | 'store_code'> & { vendor: { name: string } | null; order: { po_number: string | null } | null }): string {
  const head = ['Vendor', 'Store', 'Order PO', 'System ID', 'Vendor ID', 'UPC', 'Item name', 'Category', 'New item', 'Qty', 'Unit cost', 'Total']
  const rows = po.lines.map((l) => [po.vendor?.name ?? '', po.store_code ?? '', po.order?.po_number ?? '', l.system_id ?? '', l.vid ?? '', l.upc ?? '', l.name, l.category, l.is_new ? 'yes' : '', l.qty, l.cost ?? '', l.cost !== null ? (l.qty * l.cost).toFixed(2) : ''])
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n')
}
