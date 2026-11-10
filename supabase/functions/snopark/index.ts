// snopark: the State's Sno-Park report as an Excel file (Dana, Nov 5-6, 2026). Editors only.
//   { action: 'excel', report_id }  → fills form OHV 54SP from the report's rows (From / Including permit numbers per empty
//                                     book, the money worked out the way the sheet does), files it under CA Snow Park in
//                                     the Sno-Park folder, and the report is ready (Dana gets the check task).
// The template is Dana's own December 2025 submission with the numbers cleared, so the file looks exactly like the ones the
// State already accepts. Cells are edited in the sheet's XML; nothing else in the workbook changes.
import { unzipSync, zipSync, strFromU8, strToU8 } from 'npm:fflate@0.8.2'
import { CORS, HttpError, caller, errorResponse, json, serviceClient } from '../_shared/caller.ts'
import { SNOPARK_TEMPLATE_B64 } from '../_shared/snoparkTemplate.ts'

const DAY_ROWS = [15, 16, 17, 18, 19, 20, 21, 22, 23, 24]
const SEASON_ROWS = [29, 30, 31, 32, 33, 34]
const MONTHS = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']

interface Row { section: 'sold' | 'unsold'; kind: 'day' | 'season'; book_number: string | null; from_permit: number; to_permit: number; qty: number; sort: number }

if (import.meta.main) Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  try {
    const db = serviceClient()
    const me = await caller(req, db, true)
    const body = await req.json() as { action?: string; report_id?: string }
    if (body.action !== 'excel' || !body.report_id) throw new HttpError(400, 'Which report?')
    const { data: r } = await db.from('snopark_reports').select('*').eq('id', body.report_id).maybeSingle()
    if (!r || r.organization_id !== me.organization_id) throw new HttpError(404, 'Report not found')
    if (r.status === 'mailed') throw new HttpError(409, 'This report was mailed; its file stays as it is')
    if (!r.built_at) throw new HttpError(400, 'Pick the books first')
    const { data: s } = await db.from('snopark_seasons').select('*').eq('id', r.season_id).single()
    if (!s) throw new HttpError(404, 'Season not found')
    if (!s.vendor_id) throw new HttpError(400, 'The CA Snow Park vendor is not on this season')
    const { data: rows } = await db.from('snopark_report_rows').select('section, kind, book_number, from_permit, to_permit, qty, sort').eq('report_id', r.id).order('sort')
    const sold = ((rows ?? []) as Row[]).filter((x) => x.section === 'sold')
    const unsold = ((rows ?? []) as Row[]).filter((x) => x.section === 'unsold')
    const day = sold.filter((x) => x.kind === 'day'), season = sold.filter((x) => x.kind === 'season')
    if (day.length > DAY_ROWS.length) throw new HttpError(400, `The State's form has room for ${DAY_ROWS.length} day permit ranges; this report has ${day.length}. Mail two reports, or list consecutive books as one range.`)
    if (season.length > SEASON_ROWS.length) throw new HttpError(400, `The State's form has room for ${SEASON_ROWS.length} season permit ranges; this report has ${season.length}.`)

    const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }))
    const month = new Date(`${r.month}T12:00:00Z`)
    const label = r.kind === 'final' ? `${s.label.slice(2, 4)}-${s.label.slice(7, 9)} SNO PARK END OF SEASON REPORT` : `${MONTHS[month.getUTCMonth()]} ${month.getUTCFullYear()} SUBMISSION`
    // the State's form for this season when one was uploaded (they send a new one every year), else the built-in blank
    let template: Uint8Array | null = null
    if (s.form_link_id) {
      const { data: form } = await db.from('vendor_links').select('storage_path, file_name').eq('id', s.form_link_id).maybeSingle()
      if (form?.storage_path) {
        const { data: blob, error } = await db.storage.from('vendor-files').download(form.storage_path)
        if (error || !blob) throw new HttpError(400, `The season's form (${form.file_name ?? 'file'}) could not be opened: ${error?.message ?? 'no file'}. Upload it again on the Sno-Park page.`)
        template = new Uint8Array(await blob.arrayBuffer())
      }
    }
    const bytes = fillForm({ template, seasonLabel: s.label, label, dayRows: day, seasonRows: season, unsold, prices: { day: [Number(s.day_price), Number(s.day_commission)], season: [Number(s.season_price), Number(s.season_commission)] } })
    const mmddyy = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}-${String(today.getFullYear()).slice(2)}`
    const fileName = `${String(r.seq).padStart(2, '0')} - ${mmddyy} ${r.kind === 'final' ? label : `${MONTHS[month.getUTCMonth()]} ${month.getUTCFullYear()} SNOPARK SUBMISSION`}.xlsx`
    const path = `${me.organization_id}/${s.vendor_id}/${crypto.randomUUID()}-${fileName.replace(/[^A-Za-z0-9._-]+/g, '_')}`
    const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    const { error: upErr } = await db.storage.from('vendor-files').upload(path, bytes, { contentType: mime, upsert: false })
    if (upErr) throw new Error(`Saving the file: ${upErr.message}`)
    // the old file for this report (built again) is superseded, never a second current copy
    if (r.file_link_id) await db.from('vendor_links').update({ is_current: false, superseded_at: new Date().toISOString() }).eq('id', r.file_link_id)
    const { data: link, error: linkErr } = await db.from('vendor_links').insert({
      organization_id: me.organization_id, vendor_id: s.vendor_id, kind: 'snopark_report', label: fileName.replace(/\.xlsx$/i, ''), storage_path: path, file_name: fileName, file_size: bytes.byteLength, mime_type: mime,
      received_at: today.toISOString().slice(0, 10), doc_year: today.getFullYear(), doc_date: today.toISOString().slice(0, 10), doc_total: Number(r.total_due), source: 'manual', created_by: me.id,
      notes: `Sno-Park ${r.kind === 'final' ? 'final report' : 'report for ' + MONTHS[month.getUTCMonth()].charAt(0) + MONTHS[month.getUTCMonth()].slice(1).toLowerCase() + ' ' + month.getUTCFullYear()}: ${sold.length} book${sold.length === 1 ? '' : 's'}, $${Number(r.total_due).toFixed(2)} due to the State. Filled by VMS from the books on the Sno-Park page.`,
    }).select('id').single()
    if (linkErr) throw new Error(linkErr.message)
    await db.rpc('snopark_report_ready', { p_report: r.id, p_link: link.id })
    return json({ ok: true, file_name: fileName, link_id: link.id })
  } catch (e) {
    return errorResponse(e)
  }
})

/** The template with the cells filled: the number cells as values, the formula cells with their worked-out values. */
export function fillForm(f: { template?: Uint8Array | null; seasonLabel: string; label: string; dayRows: Row[]; seasonRows: Row[]; unsold: Row[]; prices: { day: [number, number]; season: [number, number] } }): Uint8Array {
  const tpl = f.template ?? Uint8Array.from(atob(SNOPARK_TEMPLATE_B64), (c) => c.charCodeAt(0))
  let files: Record<string, Uint8Array>
  try { files = unzipSync(tpl) } catch { throw new HttpError(400, "The season's form is not an Excel file VMS can open") }
  if (!files['xl/worksheets/sheet1.xml']) throw new HttpError(400, "The season's form has no sheet VMS can fill")
  let xml = strFromU8(files['xl/worksheets/sheet1.xml']!)
  const setNum = (ref: string, v: number | null, formula?: string) => { xml = setCell(xml, ref, v === null ? null : { v: String(v), formula }) }
  const setStr = (ref: string, v: string) => { xml = setCell(xml, ref, { v: xmlEscape(v), str: true }) }
  const money = (n: number) => Math.round(n * 100) / 100
  const put = (rows: Row[], refs: number[], price: number, comm: number) => {
    let qty = 0, amount = 0, commission = 0, due = 0
    refs.forEach((rowNo, i) => {
      const row = rows[i]
      const q = row ? row.to_permit - row.from_permit + 1 : 0
      setNum(`A${rowNo}`, row ? row.from_permit : null)
      setNum(`B${rowNo}`, row ? row.to_permit : null)
      setNum(`K${rowNo}`, row ? 1 : 0)
      setNum(`C${rowNo}`, q, `B${rowNo}-A${rowNo}+K${rowNo}`)   // the State's own sheet leaves this formula out of some rows
      setNum(`D${rowNo}`, money(q * price))
      setNum(`G${rowNo}`, money(q * comm))
      setNum(`J${rowNo}`, money(q * (price - comm)))
      qty += q; amount += q * price; commission += q * comm; due += q * (price - comm)
    })
    return { qty, amount: money(amount), commission: money(commission), due: money(due) }
  }
  const d = put(f.dayRows, DAY_ROWS, f.prices.day[0], f.prices.day[1])
  const s = put(f.seasonRows, SEASON_ROWS, f.prices.season[0], f.prices.season[1])
  setNum('C25', d.qty); setNum('D25', d.amount); setNum('G25', d.commission); setNum('J25', d.due)
  setNum('C35', s.qty); setNum('D35', s.amount); setNum('G35', s.commission); setNum('J35', s.due)
  // the grand total cell and the label area move a row between the State's yearly forms: found by formula and by merge
  const totalRef = xml.match(/<c r="([A-Z]+\d+)"[^>]*><f>J25\+J35<\/f>/)?.[1] ?? 'J37'
  setNum(totalRef, money(d.due + s.due))
  setStr('C2', f.seasonLabel)
  const labelRef = xml.match(/<mergeCell ref="(G\d+):J45"/)?.[1] ?? 'G40'
  setStr(labelRef, f.label)
  // the final report's unsold permits, under the ranges (the State's Excel has no unsold section; the printed form does)
  if (f.unsold.length) {
    const text = ['UNSOLD PERMITS GOING BACK:', ...f.unsold.map((u) => `${u.kind === 'day' ? 'Day-use' : 'Season'} book ${u.book_number ?? ''}: ${u.from_permit} - ${u.to_permit} (${u.to_permit - u.from_permit + 1})`)]
    text.slice(0, 11).forEach((t, i) => setStr(`A${40 + i}`, t))
  }
  files['xl/worksheets/sheet1.xml'] = strToU8(xml)
  return zipSync(files, { level: 6 })
}

/** Replace one cell in the sheet XML, keeping its style; a missing cell is added to its row in column order. */
function setCell(xml: string, ref: string, val: { v: string; str?: boolean; formula?: string } | null): string {
  const rowNo = ref.replace(/[A-Z]+/, '')
  const col = ref.replace(/\d+/, '')
  const cellRe = new RegExp(`<c r="${ref}"(?: s="(\\d+)")?(?: t="[a-zA-Z]+")?(?:/>|>.*?</c>)`, 's')
  const m = xml.match(cellRe)
  const style = m?.[1] ? ` s="${m[1]}"` : ''
  // a formula cell keeps its formula (the State's sheet still adds up if they change a number); only the shown value changes
  const formula = m?.[0].match(/<f\b[^>]*\/>|<f\b[^>]*>.*?<\/f>/s)?.[0] ?? (val?.formula ? `<f>${val.formula}</f>` : '')
  const cell = val === null ? `<c r="${ref}"${style}/>` : val.str ? `<c r="${ref}"${style} t="inlineStr"><is><t>${val.v}</t></is></c>` : `<c r="${ref}"${style}>${formula}<v>${val.v}</v></c>`
  if (m) return xml.replace(cellRe, cell)
  // no such cell yet: put it in the row (made if missing), after the last cell whose column comes before it
  const rowRe = new RegExp(`<row r="${rowNo}"[^>]*>(.*?)</row>`, 's')
  const rm = xml.match(rowRe)
  if (!rm) return xml.replace('</sheetData>', `<row r="${rowNo}">${cell}</row></sheetData>`)
  const cells = rm[1]!.match(/<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>.*?<\/c>)/gs) ?? []
  const before = cells.filter((c) => colIndex(c.match(/r="([A-Z]+)/)![1]!) < colIndex(col))
  const after = cells.filter((c) => colIndex(c.match(/r="([A-Z]+)/)![1]!) > colIndex(col))
  return xml.replace(rowRe, rm[0].replace(rm[1]!, [...before, cell, ...after].join('')))
}
const colIndex = (c: string) => c.split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0)
const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
