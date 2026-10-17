// The Worldwide portal's vendor answer (selectVendor → vendorDetail), read into plain fields (Dana, Oct 16). Pure: no
// database, so the import and its tests share it. Portal values are kept as the portal shows them; only freight terms,
// dates, billing terms and the contact kind are interpreted (docs/wwd-portal-import.md).

export interface PortalPhone { type: 'work' | 'cell' | 'fax'; number: string }
export interface PortalContact {
  name: string; title: string | null; email: string | null; phones: PortalPhone[]
  /** the rep company when the person is not the vendor's own (Harry Spotts, Proactive Sales and Marketing) */
  company: string | null; territory: string | null
  kind: 'rep' | 'customer_service' | 'ap' | 'owner' | 'other'
}
export interface FreightTier { text: string; kind: 'prepaid' | 'allowance' | 'part_allowance' | 'prepaid_add' | 'collect' | 'other'; at: number | null; pct: number | null }
export interface PortalDocument { name: string; description: string | null }
export interface PortalProgram {
  key: string; name: string; kind: 'standard' | 'show'; season: 'Spring' | 'Fall' | null; year: number | null
  expires_on: string | null; ship_begin: string | null; ship_end: string | null
  discount: string | null; billing_terms: string | null; freight_terms: string | null; freight_tiers: FreightTier[]
  minimum_order: string | null; shipping_points: string | null; documents: PortalDocument[]
}
export interface PortalAddress { address: string | null; city: string | null; state: string | null; postal_code: string | null; phone: string | null; fax: string | null }
export interface PortalResources {
  defective_policy: string | null; ra_required: boolean | null; return_address: string | null
  freight_to_vendor: string | null; freight_from_vendor: string | null; compensation: string | null; comments: string | null
  liability_insurance: string | null
  /** shown on the portal as "Zero Upcharge" (its field is named rebateProgram) */
  zero_upcharge: boolean | null
}
export interface PortalVendor {
  number: string; name: string
  address: PortalAddress | null; po_address: PortalAddress | null
  contacts: PortalContact[]; programs: PortalProgram[]
  product_lines: { category: string; lines: string[] }[]
  resources: PortalResources | null; return_notes: string | null
  brands: string[]; documents: PortalDocument[]
  /** the everyday terms from the Standard program, for the vendor's own fields */
  standard: { minimum_order: string | null; billing_terms: string | null; freight_program: string | null; free_shipping_policy: 'never' | 'sometimes' | 'always' | null; free_shipping_threshold: number | null }
  /** the first company address among the vendor's own people, for the line's email */
  email: string | null
}

type Raw = Record<string, unknown>
const s = (x: unknown): string | null => {
  const t = typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : typeof x === 'number' ? String(x) : ''
  return t === '' ? null : t
}
/** A portal list with its empty entries (null, {}) left out. */
const list = (x: unknown): Raw[] => (Array.isArray(x) ? x.filter((r): r is Raw => !!r && typeof r === 'object' && Object.keys(r).length > 0) : [])
const joined = (xs: unknown[], sep = '; ') => {
  const out = xs.map(s).filter((x): x is string => !!x)
  return out.length ? out.join(sep) : null
}

/** "20260903" → "2026-09-03"; "0" or anything else → null. */
export function portalDate(x: unknown): string | null {
  const t = s(x)
  if (!t || !/^\d{8}$/.test(t)) return null
  const d = `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`
  return Number.isNaN(Date.parse(d)) ? null : d
}

const money = (t: string): number | null => {
  const m = /\$\s?([\d,]+(?:\.\d+)?)/.exec(t)
  return m ? Number(m[1].replace(/,/g, '')) : null
}

/** One freight term: "PPD $4000" (prepaid, free at $4,000), "FFA Over $500" (full freight allowed), "50% FA $3000",
 *  "PPD & Add To Invoice" (they pay, then bill us), "Collect" (we pay). Other words stay in the text. */
export function freightTier(text: string): FreightTier {
  const t = text.replace(/\s+/g, ' ').trim()
  const at = money(t)
  const pct = /(\d+(?:\.\d+)?)\s*%/.exec(t)
  if (/^collect\b/i.test(t)) return { text: t, kind: 'collect', at: null, pct: pct ? Number(pct[1]) : null }
  if (/^ppd\b/i.test(t) && /add\s+to\s+invoice/i.test(t)) return { text: t, kind: 'prepaid_add', at, pct: null }
  if (/^\d+(?:\.\d+)?\s*%\s*(fa|ffa|freight allowance)\b/i.test(t)) return { text: t, kind: 'part_allowance', at, pct: pct ? Number(pct[1]) : null }
  if (/^ppd\b/i.test(t)) return { text: t, kind: 'prepaid', at, pct: null }
  if (/^ffa\b/i.test(t)) return { text: t, kind: 'allowance', at, pct: null }
  return { text: t, kind: 'other', at, pct: pct ? Number(pct[1]) : null }
}

/** Free shipping from the freight terms: a $ amount → sometimes (lowest amount); prepaid or full allowance with no
 *  amount → always, unless it names some other condition ("PPD 6 Guns") → sometimes; collect or prepaid-and-add only →
 *  never. Nothing to go on → null. */
export function freeShipping(tiers: FreightTier[]): { policy: 'never' | 'sometimes' | 'always' | null; threshold: number | null } {
  const free = tiers.filter((t) => t.kind === 'prepaid' || t.kind === 'allowance')
  const amounts = free.map((t) => t.at).filter((x): x is number => x != null && x > 0)
  if (amounts.length) return { policy: 'sometimes', threshold: Math.min(...amounts) }
  const plain = free.filter((t) => /^(ppd|ffa)(\s+(lower 48 states|continental us|48 states|usa?))?$/i.test(t.text))
  if (plain.length) return { policy: 'always', threshold: null }
  if (free.length) return { policy: 'sometimes', threshold: null }
  if (tiers.some((t) => t.kind === 'collect' || t.kind === 'prepaid_add')) return { policy: 'never', threshold: null }
  return { policy: null, threshold: null }
}

function contactKind(title: string | null, company: string | null): PortalContact['kind'] {
  const t = (title ?? '').toLowerCase()
  if (/customer service|sales support|claim/.test(t)) return 'customer_service'
  if (/\b(ar|ap)\b|credit|payment|account|controller|cfo|factor/.test(t)) return 'ap'
  if (/sales|rep\b|representative/.test(t) || company) return 'rep'
  if (/president|owner|ceo|general manager/.test(t)) return 'owner'
  return 'other'
}

function phone(x: unknown): string | null {
  const t = s(x)
  return t && /\d{3}.*\d{4}/.test(t) ? t : null
}

function address(a: Raw | undefined): PortalAddress | null {
  if (!a) return null
  const out: PortalAddress = {
    address: joined([a.address1, a.address2, a.address3], ', '), city: s(a.city), state: s(a.state), postal_code: s(a.zip),
    phone: phone(a.phone), fax: phone(a.fax),
  }
  return Object.values(out).some((v) => v) ? out : null
}

const SEASON: Record<string, 'Spring' | 'Fall'> = { SPR: 'Spring', FAL: 'Fall' }

function program(p: Raw, docs: Map<string, PortalDocument[]>): PortalProgram {
  const name = s(p.name) ?? 'Standard'
  const isShow = /show/i.test(name) || !!s(p.show)
  const code = s(p.show)?.toUpperCase() ?? ''
  const year = Number(s(p.year)) || null
  const season = SEASON[code] ?? (/spring/i.test(String(p.showDescription)) ? 'Spring' : /fall/i.test(String(p.showDescription)) ? 'Fall' : null)
  // a vendor can list one program per brand or line ("Standard" for SMITH GOGGLES and for SMITH SUNGLASSES)
  const group = s(p.group)
  const base = isShow ? `${code || (season ?? 'SHOW').slice(0, 3).toUpperCase()}${year ?? ''}` : name.toLowerCase() === 'standard' ? 'standard' : name.toLowerCase()
  const key = group ? `${base}:${group.toLowerCase()}` : base
  const terms = [p.freightTerms1, p.freightTerms2, p.freightTerms3].map(s).filter((x): x is string => !!x)
  const own = list(p.uploadedDocumentList).flatMap((d) => documentsOf(d))
  return {
    key, kind: isShow ? 'show' : 'standard', season: isShow ? season : null, year: isShow ? year : null,
    name: `${isShow ? `${s(p.showDescription) ?? (season ? `${season} Show` : 'Show')}${year ? ` ${year}` : ''}` : name}${group ? ` (${group})` : ''}`,
    expires_on: portalDate(p.expirationDate), ship_begin: portalDate(p.beginingShipDate), ship_end: portalDate(p.endShipDate),
    discount: joined([p.discount1, p.discount2, p.discount3, p.discount4]),
    billing_terms: joined([p.billingTerms1, p.billingTerms2, p.billingTerms3]),
    freight_terms: terms.length ? terms.join('; ') : null, freight_tiers: terms.map(freightTier),
    minimum_order: joined([p.minimumOrder1, p.minimumOrder2, p.minimumOrder3]),
    shipping_points: joined([p.shippingPoints1, p.shippingPoints2, p.shippingPoints3]),
    documents: [...own, ...(docs.get(key) ?? [])],
  }
}

/** {"SPR2026SHOW": [{documentName, documentDesc}]} → documents by program key ("SPR2026"). */
function documentsOf(d: Raw): PortalDocument[] {
  if (s(d.documentName)) return [{ name: s(d.documentName)!, description: s(d.documentDesc) }]
  return Object.values(d).flatMap((v) => (Array.isArray(v) ? list(v).flatMap(documentsOf) : []))
}
function documentsByProgram(entries: Raw[]): Map<string, PortalDocument[]> {
  const out = new Map<string, PortalDocument[]>()
  for (const d of entries) {
    for (const [k, v] of Object.entries(d)) {
      if (!Array.isArray(v)) continue
      const key = k.toUpperCase().replace(/SHOW$/, '')
      out.set(key, [...(out.get(key) ?? []), ...list(v).flatMap(documentsOf)])
    }
  }
  return out
}

function resources(r: Raw | undefined): PortalResources | null {
  if (!r) return null
  const yn = (x: unknown) => { const t = s(x)?.toUpperCase(); return t === 'Y' || t === 'YES' ? true : t === 'N' || t === 'NO' ? false : null }
  const ins = s(r.liabilityInsurance)
  const amt = Number(s(r.liabilityInsuranceAmount)) || null
  return {
    defective_policy: joined([r.defectiveGoodsPolicy1, r.defectiveGoodsPolicy2, r.defectiveGoodsPolicy3, r.defectiveGoodsPolicy4, r.defectiveGoodsPolicy5], ' '),
    ra_required: yn(r.raRequired),
    return_address: joined([r.goodsReturnAddress1, r.goodsReturnAddress2, r.goodsReturnAddress3, r.goodsReturnAddress4], ', '),
    freight_to_vendor: s(r.defectiveFreightToVendor), freight_from_vendor: s(r.defectiveFreightFromVendor),
    compensation: joined([r.defectiveCompensationMethod, r.defectiveCompensationMethod2]),
    comments: joined([r.defectiveGoodsComment1, r.defectiveGoodsComment2, r.defectiveGoodsComment3, r.defectiveGoodsComment4], ' '),
    liability_insurance: ins ? `${ins}${amt ? ` ($${amt.toLocaleString('en-US')})` : ''}` : null,
    zero_upcharge: yn(r.rebateProgram),
  }
}

/** The returns paragraph for the vendor's return notes. */
export function returnNotes(r: PortalResources | null): string | null {
  if (!r) return null
  const parts = [
    r.defective_policy ? `Defective goods: ${r.defective_policy}.` : null,
    r.ra_required == null ? null : r.ra_required ? 'RA required.' : 'No RA needed.',
    r.return_address ? `Return to: ${r.return_address}.` : null,
    r.freight_to_vendor ? `Freight to vendor: ${r.freight_to_vendor}.` : null,
    r.freight_from_vendor ? `Freight back: ${r.freight_from_vendor}.` : null,
    r.compensation ? `Paid back by: ${r.compensation}.` : null,
    r.comments,
  ].filter(Boolean)
  return parts.length ? `${parts.join(' ')} (Worldwide portal)` : null
}

const FREEMAIL = /@(gmail|yahoo|hotmail|outlook|aol|icloud|comcast|att|sbcglobal|msn|live|me)\./i

/** One vendor from the portal: {number, name, detail: {vendorDetail, success}}. */
export function readPortalVendor(v: { number: string | number; name: string; detail?: { vendorDetail?: Raw } | null }): PortalVendor | null {
  const d = v.detail?.vendorDetail
  if (!d) return null
  const addr = address(d.vendorAddress as Raw | undefined)
  const po = address(d.poAddress as Raw | undefined)
  const contacts: PortalContact[] = list(d.contactList).map((c) => {
    const title = s(c.jobTitle)
    const company = s(c.category)
    const email = s(c.email)?.toLowerCase() ?? null
    const phones: PortalPhone[] = []
    const work = phone(c.phone), cell = phone(c.mobile)
    if (work) phones.push({ type: 'work', number: work })
    if (cell && cell !== work) phones.push({ type: 'cell', number: cell })
    return {
      name: joined([c.firstName, c.lastName], ' ') ?? email ?? 'Unknown', title, email: email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null,
      phones, company, territory: s(c.geographicalArea), kind: contactKind(title, company),
    }
  })
  const docs = documentsByProgram(list(d.uploadedDocumentList))
  const programs = list(d.programList).map((p) => program(p, docs))
  const used = new Set(programs.map((p) => p.key))
  const res = resources(list(d.resourceList)[0])
  const std = programs.find((p) => p.key === 'standard') ?? programs.find((p) => p.kind === 'standard') ?? null
  const free = freeShipping(std?.freight_tiers ?? [])
  const brands = (s(String(d.brands ?? '').replace(/<[^>]*>/g, ' ')) ?? '').replace(/^brands:\s*/i, '')
  const own = contacts.filter((c) => !c.company && c.email && !FREEMAIL.test(c.email))
  return {
    number: String(v.number), name: s((d.vendorAddress as Raw | undefined)?.name) ?? s(v.name) ?? String(v.number),
    address: addr, po_address: po && JSON.stringify(po) !== JSON.stringify(addr) ? po : null,
    contacts, programs,
    product_lines: list(d.productLineList).map((l) => ({ category: s(l.masterCategory) ?? '', lines: (Array.isArray(l.detailCategoryList) ? l.detailCategoryList as unknown[] : []).map(s).filter((x): x is string => !!x) })).filter((l) => l.category || l.lines.length),
    resources: res, return_notes: returnNotes(res),
    brands: brands ? brands.split(/\s*,\s*/).filter(Boolean) : [],
    documents: [...docs.entries()].filter(([k]) => !used.has(k)).flatMap(([, x]) => x),
    standard: { minimum_order: std?.minimum_order ?? null, billing_terms: std?.billing_terms ?? null, freight_program: std?.freight_terms ?? null, free_shipping_policy: free.policy, free_shipping_threshold: free.threshold },
    email: own[0]?.email ?? null,
  }
}

/** "Net 30 Days" → "net 30", "2% 10 Net 30 Days" → "2% 10 net 30": for matching our payment terms by name. */
export const termsKey = (t: string | null | undefined) => (t ?? '').toLowerCase().replace(/\bdays?\b/g, '').replace(/\s+/g, ' ').trim()
