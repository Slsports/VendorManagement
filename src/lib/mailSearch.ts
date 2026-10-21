// Mail search (Dana, Oct 21): one box that searches everything (text, names, addresses, vendor, contacts, attachment
// names, PO), suggestions as you type, and filter buttons. The search lives in the page address so Back returns to it.

export interface MailFilters {
  q: string
  /** with a person: their address, and the name shown on the chip */
  with?: string; withName?: string
  vendorId?: string; vendorName?: string
  repGroupId?: string; repGroupName?: string
  orderId?: string; orderName?: string
  from?: string; to?: string
  attach?: 'yes' | 'no'
  file?: 'pdf' | 'sheet' | 'picture'
  days?: '7' | '30' | '90'
  since?: string; until?: string
  dir?: 'in' | 'out'
  found?: 'confirmation' | 'invoice' | 'shipping' | 'artwork'
}

const KEYS: Record<Exclude<keyof MailFilters, 'q'>, string> = {
  with: 'with', withName: 'withName', vendorId: 'sv', vendorName: 'svName', repGroupId: 'rg', repGroupName: 'rgName',
  orderId: 'so', orderName: 'soName', from: 'from', to: 'to', attach: 'attach', file: 'file', days: 'days',
  since: 'since', until: 'until', dir: 'dir', found: 'found',
}

export function filtersFromParams(params: URLSearchParams): MailFilters {
  const f: MailFilters = { q: params.get('q') ?? '' }
  for (const [k, p] of Object.entries(KEYS)) { const v = params.get(p); if (v) (f as unknown as Record<string, string>)[k] = v }
  return f
}

/** The page address with these filters (other settings kept). */
export function filtersToParams(params: URLSearchParams, f: MailFilters): URLSearchParams {
  const next = new URLSearchParams(params)
  if (f.q) next.set('q', f.q); else next.delete('q')
  for (const [k, p] of Object.entries(KEYS)) { const v = (f as unknown as Record<string, string | undefined>)[k]; if (v) next.set(p, v); else next.delete(p) }
  return next
}

/** Anything besides the words: a person, vendor, rep group, order or a filter button. */
export const hasFilters = (f: MailFilters) => Object.keys(KEYS).some((k) => k !== 'withName' && !k.endsWith('Name') && (f as unknown as Record<string, unknown>)[k])
export const isSearching = (f: MailFilters) => !!f.q.trim() || hasFilters(f)

/**
 * Typed shortcuts, so nobody has to learn them but they work: from:sharon, to:jarrett, has:attachment, has:pdf,
 * has:spreadsheet, has:picture, no:attachment, after:2026-09-01, before:2026-10-01, in:sent / in:received.
 */
export function parseShortcuts(text: string): { q: string; filters: Partial<MailFilters> } {
  const filters: Partial<MailFilters> = {}
  const words: string[] = []
  for (const w of text.trim().split(/\s+/).filter(Boolean)) {
    const m = w.match(/^(from|to|has|no|after|before|in):(.+)$/i)
    if (!m) { words.push(w); continue }
    const [, key, raw] = m
    const v = raw!.toLowerCase()
    if (key!.toLowerCase() === 'from') filters.from = raw
    else if (key!.toLowerCase() === 'to') filters.to = raw
    else if (key!.toLowerCase() === 'has') {
      if (v.startsWith('attach')) filters.attach = 'yes'
      else if (v === 'pdf') { filters.attach = 'yes'; filters.file = 'pdf' }
      else if (/^(spreadsheet|excel|sheet|xlsx?|csv)$/.test(v)) { filters.attach = 'yes'; filters.file = 'sheet' }
      else if (/^(picture|pictures|image|images|photo|photos)$/.test(v)) { filters.attach = 'yes'; filters.file = 'picture' }
      else words.push(w)
    } else if (key!.toLowerCase() === 'no' && v.startsWith('attach')) filters.attach = 'no'
    else if (key!.toLowerCase() === 'after' && /^\d{4}-\d{2}-\d{2}$/.test(v)) filters.since = v
    else if (key!.toLowerCase() === 'before' && /^\d{4}-\d{2}-\d{2}$/.test(v)) filters.until = v
    else if (key!.toLowerCase() === 'in' && v === 'sent') filters.dir = 'out'
    else if (key!.toLowerCase() === 'in' && /^(received|inbox)$/.test(v)) filters.dir = 'in'
    else words.push(w)
  }
  return { q: words.join(' '), filters }
}

const dayOffset = (n: number, today: Date) => { const d = new Date(today); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }

/** What the search function is asked for. `scope`: the mailbox, or a vendor page's vendor, or the Sent tab. */
export function toSearchArgs(f: MailFilters, scope: { box?: string; vendorId?: string; dir?: 'in' | 'out' } = {}, today = new Date()) {
  const p: Record<string, string | boolean> = {}
  if (scope.box) p.box = scope.box
  const vendor = scope.vendorId ?? f.vendorId
  if (vendor) p.vendor_id = vendor
  if (f.with) p.with = f.with
  if (f.repGroupId) p.rep_group_id = f.repGroupId
  if (f.orderId) p.order_id = f.orderId
  if (f.from) p.from = f.from
  if (f.to) p.to = f.to
  if (f.attach) p.attach = f.attach === 'yes'
  if (f.file) p.file = f.file
  if (f.days) p.since = dayOffset(Number(f.days), today)
  else if (f.since) p.since = f.since
  if (f.until) p.until = f.until
  const dir = scope.dir ?? f.dir
  if (dir) p.dir = dir
  if (f.found) p.found = f.found
  return { p_q: f.q.trim(), p }
}

/** "Sharon's <<invoice>> for the show" → pieces to show with the matching words marked. */
export function headlineParts(h: string): { text: string; hit: boolean }[] {
  return h.split(/(<<[^>]*>>)/).filter(Boolean).map((t) => (t.startsWith('<<') ? { text: t.slice(2, -2), hit: true } : { text: t, hit: false }))
}

export const WHY_LABEL: Record<string, string> = {
  sender: 'From', 'sent to': 'Sent to', 'contact name': 'Contact', vendor: 'Vendor', attachment: 'Attachment', PO: 'PO', subject: 'Subject', text: 'In the email',
}

/** The link to a found conversation: it opens on the email that matched. */
export const matchLink = (threadId: string, m?: { email_id: string }) => `/mail/${threadId}${m ? `?email=${m.email_id}` : ''}`
