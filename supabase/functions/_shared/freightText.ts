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
