import { supabase } from '@/lib/supabase'
import { htmlTableRows, mergeBatches, parseWwdTable, scanToInvoices, type WwdBatch, type WwdFileKind } from '@/lib/wwdFiles'
import { removeStagedFiles, stageImportFile } from '@/services/documentImport'
import type { WwdInvoice } from '@/types'

export interface WwdFileRead { name: string; kind: WwdFileKind | 'scan' | null; batch: WwdBatch; error?: string }

const empty = (): WwdBatch => ({ invoices: [], payments: [], lines: [] })

/**
 * One WWD file in the browser: the Payment History "xls" (an HTML table), the EdenRed export, a payment sheet
 * in Excel or Word, or a scanned sheet (PDF or picture: Claude reads it).
 */
export async function readWwdFile(file: File, organizationId: string): Promise<WwdFileRead> {
  const name = file.name
  try {
    if (/\.(pdf|png|jpe?g)$/i.test(name) || /^(application\/pdf|image\/)/.test(file.type)) {
      const path = await stageImportFile(organizationId, file)
      try {
        const { data, error } = await supabase.functions.invoke('docs-sort', { body: { mode: 'wwd', files: [{ key: name, path: name, storage_path: path }] } })
        if (error) {
          const ctx = (error as { context?: Response }).context
          const body = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null
          throw new Error(body?.error ?? (error instanceof Error ? error.message : String(error)))
        }
        return { name, kind: 'scan', batch: { ...empty(), invoices: scanToInvoices(data as Parameters<typeof scanToInvoices>[0]) } }
      } finally {
        await removeStagedFiles([path])
      }
    }
    let tables: unknown[][][]
    if (/\.docx$/i.test(name)) {
      const mammoth = await import('mammoth')
      const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })
      const title = value.replace(/<table[\s\S]*$/, '').replace(/<[^>]+>/g, ' ')
      tables = [[[title], ...htmlTableRows(value)]]
    } else {
      const head = await file.slice(0, 400).text()
      if (/<table/i.test(head)) tables = [htmlTableRows(await file.text())]
      else {
        const XLSX = await import('xlsx')
        const book = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
        tables = book.SheetNames.map((n) => XLSX.utils.sheet_to_json<unknown[]>(book.Sheets[n]!, { header: 1, raw: true, blankrows: false, defval: '' }))
      }
    }
    const parts = tables.map((t) => parseWwdTable(t, name))
    const kind = parts.find((p) => p.kind)?.kind ?? null
    if (!kind) return { name, kind: null, batch: empty(), error: 'Not a WWD file this page knows (Payment History, EdenRed export or a payment sheet)' }
    return { name, kind, batch: mergeBatches(parts.map((p) => p.batch)) }
  } catch (err) {
    return { name, kind: null, batch: empty(), error: err instanceof Error ? err.message : String(err) }
  }
}

export interface WwdPreview { invoices: number; invoices_new: number; payments: number; payments_new: number; lines: number; names: { name: string; count: number; vendor: string | null }[] }
export interface WwdImportResult { invoices_new: number; payments_new: number; lines_new: number; orders_paid: number; no_vendor: number; linked_orders: number }

async function rpc<T>(fn: 'wwd_preview' | 'wwd_import', p: WwdBatch): Promise<T> {
  const { data, error } = await supabase.rpc(fn, { p: p as unknown as never })
  if (error) throw error
  return data as T
}

export const previewWwd = (batch: WwdBatch) => rpc<WwdPreview>('wwd_preview', batch)

/**
 * Import in pieces small enough for one request each: the files' invoices first, then the payments with their
 * lines, then scanned sheets (their cut-off numbers are found through the payment lines).
 */
export async function importWwd(batch: WwdBatch, onProgress?: (done: number, total: number) => void): Promise<WwdImportResult> {
  const files = batch.invoices.filter((i) => i.source !== 'scan')
  const scans = batch.invoices.filter((i) => i.source === 'scan')
  const steps: WwdBatch[] = []
  for (let i = 0; i < files.length; i += 100) steps.push({ ...empty(), invoices: files.slice(i, i + 100) })
  for (let i = 0; i < batch.lines.length; i += 300) {
    const lines = batch.lines.slice(i, i + 300)
    const keys = new Set(lines.map((l) => `${l.ref}|${l.pay_date}`))
    steps.push({ invoices: [], lines, payments: batch.payments.filter((p) => keys.has(`${p.ref}|${p.pay_date}`)) })
  }
  const linked = new Set(batch.lines.map((l) => `${l.ref}|${l.pay_date}`))
  const lone = batch.payments.filter((p) => !linked.has(`${p.ref}|${p.pay_date}`))
  if (lone.length) steps.push({ ...empty(), payments: lone })
  for (let i = 0; i < scans.length; i += 100) steps.push({ ...empty(), invoices: scans.slice(i, i + 100) })
  const total: WwdImportResult = { invoices_new: 0, payments_new: 0, lines_new: 0, orders_paid: 0, no_vendor: 0, linked_orders: 0 }
  for (const [n, step] of steps.entries()) {
    const r = await rpc<WwdImportResult>('wwd_import', step)
    total.invoices_new += r.invoices_new; total.payments_new += r.payments_new; total.lines_new += r.lines_new; total.orders_paid += r.orders_paid
    total.no_vendor = r.no_vendor; total.linked_orders = r.linked_orders
    onProgress?.(n + 1, steps.length)
  }
  return total
}

export interface WwdInvoiceRow extends WwdInvoice {
  vendor: { id: string; name: string } | null
  order: { id: string; order_date: string | null; po_number: string | null; description: string | null } | null
  wwd_payment_lines: { amount: number; wwd_payments: { ref: string; pay_date: string } | null }[]
}

const INVOICE_SELECT = '*, vendor:vendors!wwd_invoices_vendor_id_fkey(id, name), order:orders!wwd_invoices_order_id_fkey(id, order_date, po_number, description), wwd_payment_lines(amount, wwd_payments(ref, pay_date))'

/** A vendor's or an order's WWD invoices, newest first. */
export async function listWwdInvoices(f: { vendorId?: string; orderId?: string }, limit = 200): Promise<WwdInvoiceRow[]> {
  let q = supabase.from('wwd_invoices').select(INVOICE_SELECT)
  if (f.vendorId) q = q.eq('vendor_id', f.vendorId)
  if (f.orderId) q = q.eq('order_id', f.orderId)
  const { data, error } = await q.order('wwd_date', { ascending: false, nullsFirst: false }).limit(limit)
  if (error) throw error
  return (data ?? []) as unknown as WwdInvoiceRow[]
}

/** WWD spellings no vendor is known for yet, with how many invoices and dollars each covers. */
export async function listWwdUnsorted(organizationId: string): Promise<{ name: string; count: number; total: number; latest: string | null }[]> {
  const { data, error } = await supabase.from('wwd_invoices').select('wwd_vendor_name, amount, wwd_date').eq('organization_id', organizationId).is('vendor_id', null).not('wwd_vendor_name', 'is', null).limit(5000)
  if (error) throw error
  const by = new Map<string, { name: string; count: number; total: number; latest: string | null }>()
  for (const r of data ?? []) {
    const k = r.wwd_vendor_name!.trim()
    const g = by.get(k.toUpperCase()) ?? { name: k, count: 0, total: 0, latest: null }
    g.count++; g.total += r.amount ?? 0
    if (r.wwd_date && (!g.latest || r.wwd_date > g.latest)) g.latest = r.wwd_date
    by.set(k.toUpperCase(), g)
  }
  return [...by.values()].sort((a, b) => b.total - a.total)
}

export async function countWwdNoVendor(organizationId: string): Promise<number> {
  const { count, error } = await supabase.from('wwd_invoices').select('id', { count: 'exact', head: true }).eq('organization_id', organizationId).is('vendor_id', null)
  if (error) throw error
  return count ?? 0
}

export async function listWwdPayments(organizationId: string, limit = 12): Promise<{ id: string; ref: string; pay_date: string; total: number | null }[]> {
  const { data, error } = await supabase.from('wwd_payments').select('id, ref, pay_date, total').eq('organization_id', organizationId).order('pay_date', { ascending: false }).limit(limit)
  if (error) throw error
  return data ?? []
}

export async function assignWwdName(name: string, vendorId: string): Promise<number> {
  const { data, error } = await supabase.rpc('wwd_assign_name', { p_name: name, p_vendor: vendorId })
  if (error) throw error
  return data ?? 0
}

export async function updateWwdInvoice(id: string, change: { vendorId?: string; orderId?: string; unlinkOrder?: boolean }): Promise<void> {
  const { error } = await supabase.rpc('wwd_update_invoice', { p_id: id, p_vendor: change.vendorId ?? null, p_order: change.orderId ?? null, p_unlink_order: !!change.unlinkOrder })
  if (error) throw error
}

/** Orders with a freight allowance still to earn: unpaid, soonest pay-by date first. */
export async function freightAllowancesDue(organizationId: string): Promise<{ id: string; freight_allowance: number | null; freight_allowance_pay_by: string | null; ar_due_date: string | null; vendor: { id: string; name: string } | null }[]> {
  const { data, error } = await supabase.from('orders')
    .select('id, freight_allowance, freight_allowance_pay_by, ar_due_date, vendor:vendors(id, name)')
    .eq('organization_id', organizationId).eq('freight_allowance_offered', true).is('paid_date', null).neq('status', 'cancelled')
    .order('freight_allowance_pay_by', { ascending: true, nullsFirst: false }).limit(50)
  if (error) throw error
  return (data ?? []) as unknown as Awaited<ReturnType<typeof freightAllowancesDue>>
}
