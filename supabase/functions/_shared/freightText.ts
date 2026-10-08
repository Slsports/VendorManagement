// Which carrier emails are freight bills. Pure functions, shared by gmail-sync (Deno) and the unit tests.

/**
 * Is this carrier email a new bill? Not a reply or forward (a conversation about a bill), not a reminder,
 * tracking update, quote or meeting. "Your New Invoices from PartnerShip", "Worldwide Express Invoice …".
 */
export function looksLikeBill(subject: string | null, body: string | null, hasPdf = false): boolean {
  const s = subject ?? ''
  if (/^\s*(re|fw|fwd|aw)\s*:/i.test(s)) return false
  if (/reminder|past due|balance|meeting|quote|pricing|demo|activation|welcome|tracking|pickup|tendered|accepted:|automatic reply/i.test(s)) return false
  return /\binvoices?\b|freight bill|amount due|remittance/i.test(s) || (hasPdf && /\binvoice\b/i.test((body ?? '').slice(0, 1500)))
}

/** "Worldwide Express Invoice 10/07/2026 #261005W105025 for …" → 261005W105025. Needs a # and a digit. */
export function invoiceNumberFrom(subject: string | null): string | null {
  const m = (subject ?? '').match(/invoice[^#\n]*#\s*([A-Z0-9-]*\d[A-Z0-9-]*)/i)
  return m ? m[1]! : null
}

/** "Delivery Receipt for 518-563231" (XPO), proof of delivery, signed BOL: a receipt to file, not a bill. */
export function looksLikeReceipt(subject: string | null): boolean {
  const s = subject ?? ''
  if (/^\s*(re|fw|fwd|aw)\s*:|automatic reply|out of office/i.test(s)) return false
  return /delivery receipt|proof of delivery|\bpod\b|delivered bill of lading|signed (bol|bill of lading)/i.test(s)
}

/** "Delivery Receipt for 518-563231" → 518-563231. */
export function proNumberFrom(subject: string | null): string | null {
  const m = (subject ?? '').match(/(?:receipt|delivery|pro)\b[^0-9\n]{0,12}([0-9][0-9-]{5,})/i)
  return m ? m[1]! : null
}

/** A carrier's payment receipt ("Priority1 Payment Receipt", "Thank you for your payment"), not a bill. */
export function looksLikePaymentReceipt(subject: string | null, body: string | null): boolean {
  const s = subject ?? ''
  if (/^\s*(re|fw|fwd|aw)\s*:/i.test(s)) return false
  const re = /payment (receipt|confirmation|received|successful|processed)|receipt for (your )?payment|thank you for your payment|payment .{0,20}success/i
  return re.test(s) || re.test((body ?? '').slice(0, 600))
}

/** Our own email says something was paid ("paid by ACH 10/8/26 by Dana"): worth asking Claude. */
export function mentionsPayment(text: string | null): boolean {
  return /\bpaid\b|\bpayment\b|\bach\b|\bcheck (no|#|number)|\bpaid via\b/i.test(text ?? '')
}

/** What a person wrote above the quoted earlier emails. */
export function freshText(text: string | null): string {
  const t = text ?? ''
  const cut = [/^On .{4,200}wrote:\s*$/m, /^-{2,}\s*Original Message/im, /^_{10,}\s*$/m, /^From: .+\r?\n(Sent|Date): /m, /^>/m]
    .map((re) => re.exec(t)?.index ?? t.length).reduce((a, b) => Math.min(a, b), t.length)
  return t.slice(0, cut).trim()
}
