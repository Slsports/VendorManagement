// WWD files (Dana, Oct 9): what each of Worldwide's exports and Dana's own payment sheets says.
//   * Payment History export (.xls that is really an HTML table): Check # (the PB payment number), Check Date,
//     Check Amount, Invoice/Credit #, Invoice Date. A "TOTAL" line per payment, then one line per invoice paid.
//   * EdenRed invoice export (.xlsx): Invoice Type (DS/CM), Seq No / AR Invoice No, PO Number, Vendor Name,
//     Received Date, Invoice Number, Invoice Date, Invoice Amount, Freight Amount, AR Terms or Terms Text, Hard Due Date (AR).
//     The AP columns are WWD's side with the vendor (Nichole, Oct 19) and are never read.
//   * Dana's payment sheets (.xlsx or Word): the portal's list pasted as she paid it: Invoice #, Disc Date,
//     Disc Avail, Date Inv, Date Due, Desc, Vendor, Inv Amt, Amt Paid, Amt Due; the payment date in the title.
// No imports here, so the loading script can run this file as is.

export interface WwdInvoiceRow {
  seq: string
  kind: 'invoice' | 'credit' | 'debit' | null
  wwd_date: string | null
  vendor_name: string | null
  po_number: string | null
  vendor_invoice_number: string | null
  vendor_invoice_date: string | null
  amount: number | null
  discount: number | null
  due_date: string | null
  terms: string | null
  freight_amount: number | null
  sheet_paid_date: string | null
  /** Edenred's Posted Date: when WWD posted it to Edenred */
  posted_date?: string | null
  source: 'edenred' | 'sheet' | 'scan'
}
export interface WwdPaymentRow { ref: string; pay_date: string; total: number | null }
export interface WwdLineRow { ref: string; pay_date: string; seq: string; amount: number; wwd_date: string | null }
/** One invoice's lines from Edenred's line export (Oct 21): MfgStockNo = Vendor ID, ItemNumber = UPC. */
export interface EdenredLine { vid: string | null; upc: string | null; desc: string | null; qty: number | null; price: number | null; unit_discount: number | null; amount: number | null }
export interface EdenredInvoice { seq: string; credit: boolean; nd_freight: string | null; vendor_active: string | null; tracking: string | null; misc: number | null; freight: number | null; lines: EdenredLine[] }
export interface WwdBatch { invoices: WwdInvoiceRow[]; payments: WwdPaymentRow[]; lines: WwdLineRow[]; edenred?: EdenredInvoice[] }
export type WwdFileKind = 'history' | 'edenred' | 'edenred_lines' | 'sheet'

const pad = (n: number) => String(n).padStart(2, '0')

/** A date cell: Date, Excel serial, "9/15/2026", "10/8/26", "2026-09-15" → 2026-09-15. */
export function wwdDate(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000)
    return d.toISOString().slice(0, 10)
  }
  const s = String(v ?? '').trim()
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/)
  if (!m) return null
  const y = m[3]!.length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  const iso = `${y}-${pad(Number(m[1]))}-${pad(Number(m[2]))}`
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso ? iso : null
}

/** "$1,296.00", "($170.56)", -147.83 → a number. */
export function wwdMoney(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null
  const s = String(v ?? '').replace(/[$,\s]/g, '')
  if (!s || !/\d/.test(s)) return null
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-')
  const n = Number(s.replace(/[()-]/g, ''))
  return Number.isFinite(n) ? (neg ? -n : n) : null
}

const text = (v: unknown) => { const s = String(v ?? '').replace(/\s+/g, ' ').trim(); return s || null }
const seqOf = (v: unknown) => {
  if (typeof v === 'number' && !Number.isInteger(v)) return null
  const m = String(v ?? '').match(/(?:^|[^\d.$])(\d{5,8})(?:\.0+)?(?![\d.])/)
  return m ? m[1]!.replace(/^0+/, '') : null
}

/** The first date in a title or file name: "WORLDWIDE PAYMENT 1/16/26 $15,483.81", "PAID 3/19/24", "10-8-26_WORLDWIDE…". */
export function dateInTitle(s: string): string | null {
  for (const m of s.matchAll(/(?:^|[^\d$.])(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})(?!\d)/g)) {
    const d = wwdDate(`${m[1]}/${m[2]}/${m[3]}`)
    if (d) return d
  }
  return null
}

/** Rows of an HTML table (the Payment History "xls", a Word table converted to HTML). */
export function htmlTableRows(html: string): string[][] {
  const decode = (s: string) => s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) => [...r[1]!.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => decode(c[1]!)))
}

/** Which WWD file a table is. */
export function wwdKind(table: unknown[][]): WwdFileKind | null {
  for (const r of table.slice(0, 15)) {
    const cells = r.map((c) => String(c ?? '').trim().toLowerCase())
    if (cells.some((c) => c.startsWith('check #')) && cells.some((c) => c.startsWith('invoice/credit'))) return 'history'
    if (cells.includes('sequenceno') && cells.includes('linedescription')) return 'edenred_lines'
    if (cells.some((c) => c.startsWith('seq no'))) return 'edenred'
    if (cells.some((c) => /^invoice\s*#$/.test(c))) return 'sheet'
  }
  // a payment sheet pasted without its header row
  if (table.some((r) => r.some((c) => seqOf(c)) && r.some((c) => /^(INV|CRD|DEB)$/i.test(String(c ?? '').trim())))) return 'sheet'
  return null
}

/** Payment History: payments from the TOTAL lines, one paid line per invoice (zero lines skipped). */
export function parseHistory(table: unknown[][]): Pick<WwdBatch, 'payments' | 'lines'> {
  const payments: WwdPaymentRow[] = []
  const lines: WwdLineRow[] = []
  for (const r of table) {
    const ref = text(r[0]); const pay = wwdDate(r[1]); const amt = wwdMoney(r[2])
    if (!ref || !pay || amt === null || /^check/i.test(ref)) continue
    if (/^total$/i.test(String(r[3] ?? '').trim())) { payments.push({ ref, pay_date: pay, total: amt }); continue }
    const seq = seqOf(r[3])
    if (!seq || amt === 0) continue
    lines.push({ ref, pay_date: pay, seq, amount: amt, wwd_date: wwdDate(r[4]) })
  }
  return { payments, lines }
}

/** EdenRed invoice export: one row per WWD invoice or credit, with our PO and the vendor's own invoice. */
export function parseEdenRed(table: unknown[][]): WwdInvoiceRow[] {
  const hi = table.findIndex((r) => r.some((c) => /^seq no/i.test(String(c ?? '').trim())))
  const h = table[hi]!.map((c) => String(c ?? '').trim().toLowerCase())
  const col = (re: RegExp) => h.findIndex((c) => re.test(c))
  const C = {
    type: col(/^invoice type/), seq: col(/^seq no/), po: col(/^po number/), vendor: col(/^vendor name/), received: col(/^received date/),
    inv: col(/^invoice number/), invDate: col(/^invoice date/), amount: col(/^invoice amount/), freight: col(/^freight amount/),
    // AR is what WWD bills us; AP columns are WWD's own (Nichole, Oct 19) and never read
    posted: col(/^posted date/), terms: col(/^terms text/), arTerms: col(/^ar terms$/), due: h.findIndex((c) => /^hard due date/.test(c) && !/\(ap\)/.test(c)),
  }
  const at = (r: unknown[], i: number) => (i >= 0 ? r[i] : undefined)
  return table.slice(hi + 1).flatMap((r) => {
    const seq = seqOf(at(r, C.seq))
    if (!seq) return []
    const t = String(at(r, C.type) ?? '').trim().toUpperCase()
    return [{
      seq, kind: t === 'CM' ? 'credit' : t === 'DS' ? 'invoice' : null, wwd_date: wwdDate(at(r, C.received)), vendor_name: text(at(r, C.vendor)),
      po_number: text(at(r, C.po)), vendor_invoice_number: text(at(r, C.inv)), vendor_invoice_date: wwdDate(at(r, C.invDate)), amount: wwdMoney(at(r, C.amount)),
      discount: null, due_date: wwdDate(at(r, C.due)), terms: text(at(r, C.arTerms)) ?? text(at(r, C.terms)), freight_amount: wwdMoney(at(r, C.freight)) || null,
      sheet_paid_date: null, posted_date: wwdDate(at(r, C.posted)), source: 'edenred' as const,
    }]
  })
}

/**
 * Dana's payment sheet. The columns move between sheets (Sel or not, Desc or not, a Credits or Total Paid
 * column added), so they are found by header. A vendor typed into the invoice cell ("Troll 6875730") counts.
 * The payment date is the first date in the title rows, else in the file name.
 */
export function parseSheet(table: unknown[][], fileName: string): WwdInvoiceRow[] {
  let hi = table.findIndex((r) => r.some((c) => /^invoice\s*#$/i.test(String(c ?? '').trim())))
  if (hi < 0) {
    // pasted without its header row: rebuild it from the first line that has a WWD number and INV/CRD
    const first = table.findIndex((r) => r.some((c) => seqOf(c)) && r.some((c) => /^(INV|CRD|DEB)$/i.test(String(c ?? '').trim())))
    if (first < 0) return []
    const r = table[first]!
    const si = r.findIndex((c) => seqOf(c)); const di = r.findIndex((c) => /^(INV|CRD|DEB)$/i.test(String(c ?? '').trim()))
    if (di <= si) return []
    const head: string[] = r.map(() => '')
    head[si] = 'Invoice #'
    const between = di - si - 1
    const names = between >= 4 ? ['Disc Date', 'Disc Avail', 'Date Inv', 'Date Due'] : ['Date Inv', 'Date Due'].slice(2 - Math.min(2, between))
    names.forEach((n, k) => { head[di - names.length + k] = n })
    head[di] = 'Desc'; head[di + 1] = 'Vendor'; head[di + 2] = 'Inv Amt'; head[di + 3] = 'Amt Paid'; head[di + 4] = 'Amt Due'
    table = [...table.slice(0, first), head, ...table.slice(first)]
    hi = first
  }
  const h = table[hi]!.map((c) => String(c ?? '').replace(/\s+/g, ' ').trim().toLowerCase())
  const col = (re: RegExp) => h.findIndex((c) => re.test(c))
  const C = {
    seq: col(/^invoice\s*#$/), discAvail: col(/^disc avail/), dateInv: col(/^date inv/), dateDue: col(/^date due/), desc: col(/^desc/), vendor: col(/^vendor/),
    invAmt: col(/^inv amt/), amtDue: col(/^amt due/), discount: col(/^discount$/), credits: col(/^credits$/), totalPaid: col(/^total paid/),
  }
  const title = table.slice(0, hi).flat().map((c) => String(c ?? '')).join(' ')
  const paid = dateInTitle(title) ?? dateInTitle(fileName.replace(/\.[a-z]+$/i, ''))
  const at = (r: unknown[], i: number) => (i >= 0 ? r[i] : undefined)
  return table.slice(hi + 1).flatMap((r) => {
    const cell = String(at(r, C.seq) ?? '')
    const seq = seqOf(cell)
    if (!seq) return []
    const typed = text(cell.replace(/\d{5,8}(\.0+)?/, ''))
    const desc = String(at(r, C.desc) ?? '').trim().toUpperCase()
    const amount = wwdMoney(at(r, C.invAmt))
    const due = wwdMoney(at(r, C.totalPaid)) ?? wwdMoney(at(r, C.amtDue))
    let discount = wwdMoney(at(r, C.discount)) ?? wwdMoney(at(r, C.credits))
    if (discount === null && amount !== null && due !== null && amount > 0 && due > 0 && due < amount && amount - due < amount * 0.2) discount = Math.round((amount - due) * 100) / 100
    if (discount === null) { const avail = wwdMoney(at(r, C.discAvail)); if (avail && amount !== null && due !== null && Math.abs(amount - avail - due) < 0.02) discount = avail }
    return [{
      seq, kind: desc.startsWith('CRD') ? 'credit' : desc.startsWith('DEB') ? 'debit' : desc.startsWith('INV') ? 'invoice' : null,
      wwd_date: wwdDate(at(r, C.dateInv)), vendor_name: text(at(r, C.vendor)) ?? (typed && /[a-z]{3}/i.test(typed) ? typed : null), po_number: null,
      vendor_invoice_number: null, vendor_invoice_date: null, amount, discount: discount ? Math.abs(discount) : null, due_date: wwdDate(at(r, C.dateDue)),
      terms: null, freight_amount: null, sheet_paid_date: paid, source: 'sheet' as const,
    }]
  })
}

/**
 * Edenred's line export (Oct 21): one row per invoice line, its columns named as Edenred names them (SequenceNo,
 * DocumentType, PONumber, InvoiceNumber, MfgStockNo, ItemNumber, LineDescription…). Its invoices go through the usual
 * WWD import; the lines, ND Freight, Vendor Active and tracking go to wwd_edenred_lines.
 */
export function parseEdenredLines(table: unknown[][]): { invoices: WwdInvoiceRow[]; edenred: EdenredInvoice[] } {
  const hi = table.findIndex((r) => r.some((c) => String(c ?? '').trim().toLowerCase() === 'sequenceno'))
  const h = table[hi]!.map((c) => String(c ?? '').trim().toLowerCase())
  const col = (name: string) => h.indexOf(name.toLowerCase())
  const C = {
    seq: col('SequenceNo'), type: col('DocumentType'), po: col('PONumber'), vendor: col('VendorName'), received: col('ReceivedDate'),
    inv: col('InvoiceNumber'), invDate: col('InvoiceDate'), amount: col('InvoiceAmt'), freight: col('FreightAmount'), posted: col('PostedDate'),
    arTerms: col('ARTerms'), terms: col('TermsText'), due: col('HardDueDateAR'), nd: col('NDFreight'), active: col('VendorActive'),
    tracking: col('TrackingNo'), misc: col('MiscAmount'), discount: col('DiscountAmount'),
    vid: col('MfgStockNo'), upc: col('ItemNumber'), desc: col('LineDescription'), qty: col('Quantity'), price: col('UnitPrice'), unitDisc: col('UnitDiscount'), lineAmt: col('LineAmount'),
  }
  const at = (r: unknown[], i: number) => (i >= 0 ? r[i] : undefined)
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : wwdMoney(v))
  // unit prices and discounts keep their cents' fractions (18.1725)
  const raw = (v: unknown) => { if (v === null || v === undefined || v === '') return null; const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, '')); return Number.isFinite(n) ? n : null }
  const day = (v: unknown) => (v instanceof Date || typeof v === 'number' ? wwdDate(v) : wwdDate(String(v ?? '').slice(0, 10)))
  const invoices = new Map<string, WwdInvoiceRow>()
  const eden = new Map<string, EdenredInvoice>()
  for (const r of table.slice(hi + 1)) {
    const seq = seqOf(at(r, C.seq))
    if (!seq) continue
    const credit = String(at(r, C.type) ?? '').trim().toUpperCase() === 'CM'
    if (!invoices.has(seq)) {
      invoices.set(seq, {
        seq, kind: credit ? 'credit' : 'invoice', wwd_date: day(at(r, C.received)), vendor_name: text(at(r, C.vendor)),
        po_number: text(at(r, C.po)), vendor_invoice_number: text(at(r, C.inv)), vendor_invoice_date: day(at(r, C.invDate)),
        amount: wwdMoney(at(r, C.amount)), discount: num(at(r, C.discount)) || null, due_date: day(at(r, C.due)),
        terms: text(at(r, C.arTerms)) ?? text(at(r, C.terms)), freight_amount: wwdMoney(at(r, C.freight)) || null, sheet_paid_date: null,
        posted_date: day(at(r, C.posted)), source: 'edenred',
      })
      eden.set(seq, {
        seq, credit, nd_freight: text(at(r, C.nd)), vendor_active: text(at(r, C.active)), tracking: text(at(r, C.tracking)),
        misc: num(at(r, C.misc)), freight: num(at(r, C.freight)), lines: [],
      })
    }
    eden.get(seq)!.lines.push({
      vid: text(at(r, C.vid)), upc: text(at(r, C.upc)), desc: text(at(r, C.desc)), qty: raw(at(r, C.qty)),
      price: raw(at(r, C.price)), unit_discount: raw(at(r, C.unitDisc)), amount: num(at(r, C.lineAmt)),
    })
  }
  return { invoices: [...invoices.values()], edenred: [...eden.values()] }
}

/** One table → its part of the batch. */
export function parseWwdTable(table: unknown[][], fileName: string): { kind: WwdFileKind | null; batch: WwdBatch } {
  const kind = wwdKind(table)
  const empty: WwdBatch = { invoices: [], payments: [], lines: [] }
  if (kind === 'history') return { kind, batch: { ...empty, ...parseHistory(table) } }
  if (kind === 'edenred') return { kind, batch: { ...empty, invoices: parseEdenRed(table) } }
  if (kind === 'edenred_lines') return { kind, batch: { ...empty, ...parseEdenredLines(table) } }
  if (kind === 'sheet') return { kind, batch: { ...empty, invoices: parseSheet(table, fileName) } }
  return { kind: null, batch: empty }
}

/** What Claude read from a scanned sheet → invoice rows. */
export function scanToInvoices(r: { payments: { paid_date: string | null; lines: { seq: string; kind: 'invoice' | 'credit' | 'debit'; vendor_name: string | null; wwd_date: string | null; due_date: string | null; amount: number | null; discount: number | null }[] }[] }): WwdInvoiceRow[] {
  return r.payments.flatMap((p) => p.lines.flatMap((l) => {
    const seq = seqOf(l.seq)
    if (!seq) return []
    return [{
      seq, kind: l.kind, wwd_date: wwdDate(l.wwd_date), vendor_name: text(l.vendor_name), po_number: null, vendor_invoice_number: null, vendor_invoice_date: null,
      amount: l.amount, discount: l.discount || null, due_date: wwdDate(l.due_date), terms: null, freight_amount: null, sheet_paid_date: wwdDate(p.paid_date), source: 'scan' as const,
    }]
  }))
}

export function mergeBatches(parts: WwdBatch[]): WwdBatch {
  return { invoices: parts.flatMap((p) => p.invoices), payments: parts.flatMap((p) => p.payments), lines: parts.flatMap((p) => p.lines), edenred: parts.flatMap((p) => p.edenred ?? []) }
}
