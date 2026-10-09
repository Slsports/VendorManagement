// Bill.com's Payments export (Dana, Oct 9): Confirmation number, Vendor, Process date, Payment status,
// Payment method, Payment amount, Arrival date, Invoice number, Paid from, Vendor credit, Currency.

export interface BillcomRow {
  confirmation: string | null
  payee: string
  process_date: string | null
  status: string | null
  method: string | null
  amount: number | null
  arrival_date: string | null
  invoice_number: string | null
  paid_from: string | null
}

const COLS: [keyof BillcomRow, RegExp][] = [
  ['confirmation', /confirmation/i],
  ['payee', /^(vendor|payee)( name)?$/i],
  ['process_date', /process date|payment date|^date$/i],
  ['status', /status/i],
  ['method', /method/i],
  ['amount', /amount/i],
  ['arrival_date', /arrival/i],
  ['invoice_number', /invoice/i],
  ['paid_from', /paid from|account/i],
]

/** "Sep 21, 2026" / 9/21/2026 / a date cell → 2026-09-21. */
export function isoDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  const s = String(v ?? '').trim()
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : isoDate(d)
}

export function money(v: unknown): number | null {
  if (typeof v === 'number') return v
  const s = String(v ?? '').replace(/[$,\s]/g, '')
  if (!s) return null
  const n = Number(s.startsWith('(') ? `-${s.replace(/[()]/g, '')}` : s)
  return Number.isFinite(n) ? n : null
}

/** The rows of the export: finds the header row, then one payment per line that names a vendor. */
export function billcomRows(table: unknown[][]): BillcomRow[] {
  const headerAt = table.findIndex((r) => r.some((c) => /confirmation/i.test(String(c ?? ''))) && r.some((c) => /^(vendor|payee)/i.test(String(c ?? '').trim())))
  if (headerAt < 0) throw new Error('This does not look like the Bill.com Payments export (no "Confirmation number" and "Vendor" columns).')
  const header = table[headerAt]!.map((c) => String(c ?? '').trim())
  const at = new Map<keyof BillcomRow, number>()
  for (const [key, re] of COLS) {
    const i = header.findIndex((h, idx) => re.test(h) && ![...at.values()].includes(idx))
    if (i >= 0) at.set(key, i)
  }
  const get = (r: unknown[], k: keyof BillcomRow) => (at.has(k) ? r[at.get(k)!] : undefined)
  const text = (v: unknown) => { const s = String(v ?? '').trim(); return s || null }
  return table.slice(headerAt + 1).flatMap((r) => {
    const payee = text(get(r, 'payee'))
    if (!payee) return []
    return [{
      confirmation: text(get(r, 'confirmation')), payee, process_date: isoDate(get(r, 'process_date')), status: text(get(r, 'status')),
      method: text(get(r, 'method')), amount: money(get(r, 'amount')), arrival_date: isoDate(get(r, 'arrival_date')),
      invoice_number: text(get(r, 'invoice_number')), paid_from: text(get(r, 'paid_from')),
    }]
  })
}
