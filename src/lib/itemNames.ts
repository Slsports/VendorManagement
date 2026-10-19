import { changeKind, checkName, fixName, fixVendorId, lsContext, outsideSop, type NameProblem } from '../../supabase/functions/_shared/itemNameSop.ts'
import type { ItemNameChange } from '@/types'

// The Item names page (Trevor's SOP-INV-001-NC, Dana Oct 19): every active LS item's name checked, sorted into what
// VMS can fix with no new shelf tag, Vendor ID changes, and names a person has to look at.

export interface LsNameItem { item_id: string; description: string; vendor_item_id: string | null; category_path: string | null; default_vendor_id: string | null }
export interface NameVendor { id: string; name: string; lightspeed_vendor_id: string | null; vid_in_description: boolean }

export type NameTab = 'quick' | 'vendor_id' | 'look' | 'waiting' | 'left' | 'passing'
export const NAME_TABS: { key: NameTab; label: string; hint: string }[] = [
  { key: 'quick', label: 'Quick fixes', hint: 'Capitals, spacing, marks and approved shorthand. No new shelf tag needed.' },
  { key: 'vendor_id', label: 'Vendor ID', hint: 'The Vendor ID goes last for Fishing and the listed vendors (Coghlans, World Famous Sports, Lazy One, Ty), and comes off for everyone else. Changes what the name says: a new shelf tag.' },
  { key: 'look', label: 'Needs a look', hint: 'Things VMS cannot fix on its own (order of the parts, brand, over 52, duplicates). Type the new name.' },
  { key: 'waiting', label: 'Sent / waiting', hint: 'Approved names on their way to Lightspeed, and any Lightspeed did not take.' },
  { key: 'left', label: 'Left as is', hint: 'Names you chose to leave. They come back if the name changes in Lightspeed.' },
  { key: 'passing', label: 'Pass the SOP', hint: 'Names that already follow the SOP.' },
]

export interface NameRow {
  item: LsNameItem
  vendor: NameVendor | null
  problems: NameProblem[]
  /** fixName's result when it differs */
  quick: string | null
  /** the Vendor ID fix (null: VMS can't tell) when the Vendor ID is wrong */
  vid: string | null
  vidWrong: boolean
  /** problems left after VMS's fixes */
  left: NameProblem[]
  change: ItemNameChange | null
  tabs: NameTab[]
}

/** Every item's row, and how many are in each tab. */
export function classifyNames(items: LsNameItem[], vendors: NameVendor[], changes: ItemNameChange[]) {
  const byLs = new Map<string, NameVendor>()
  for (const v of vendors) if (v.lightspeed_vendor_id && !byLs.has(v.lightspeed_vendor_id)) byLs.set(v.lightspeed_vendor_id, v)
  const counts = new Map<string, number>()
  for (const i of items) counts.set(i.description.trim().toUpperCase(), (counts.get(i.description.trim().toUpperCase()) ?? 0) + 1)
  const dupNames = new Set([...counts].filter(([, n]) => n > 1).map(([k]) => k))
  const open = new Map<string, ItemNameChange>()
  for (const c of changes) if (c.status !== 'sent' || !open.has(c.ls_item_id)) open.set(c.ls_item_id, c)
  const rows: NameRow[] = []
  for (const item of items) {
    if (outsideSop(item.category_path)) continue
    const vendor = item.default_vendor_id ? byLs.get(item.default_vendor_id) ?? null : null
    const ctx = { ...lsContext(item, vendor), otherNames: dupNames }
    const problems = checkName(item.description, ctx)
    const fixed = fixName(item.description, ctx)
    const quick = fixed !== item.description ? fixed : null
    const vidWrong = problems.some((p) => p.code === 'vendor_id' || p.code === 'vendor_id_extra')
    const vid = vidWrong ? fixVendorId(fixed, ctx) : null
    const left = checkName(vid ?? fixed, { ...ctx, otherNames: undefined }).filter((p) => !p.fixable && !(p.code === 'vendor_id' && vid === null))
    if (dupNames.has(item.description.trim().toUpperCase())) left.push(problems.find((p) => p.code === 'duplicate')!)
    const change = open.get(item.item_id) ?? null
    const tabs: NameTab[] = []
    if (change && change.old_name === item.description && change.status !== 'sent') tabs.push(change.status === 'skipped' ? 'left' : 'waiting')
    else if (!problems.length) tabs.push('passing')
    else {
      if (quick) tabs.push('quick')
      if (vidWrong) tabs.push(vid === null ? 'look' : 'vendor_id')
      if (left.length && !tabs.includes('look')) tabs.push('look')
      if (!tabs.length) tabs.push('look')
    }
    rows.push({ item, vendor, problems, quick, vid, vidWrong, left, change, tabs })
  }
  const tabCounts = Object.fromEntries(NAME_TABS.map((t) => [t.key, rows.filter((r) => r.tabs.includes(t.key)).length])) as Record<NameTab, number>
  return { rows, tabCounts, names: new Set(counts.keys()) }
}

/** The name a tab offers for a row before anyone types. */
export function proposedName(row: NameRow, tab: NameTab): string {
  const fixed = row.quick ?? row.item.description
  if (tab === 'quick') return fixed
  if (tab === 'vendor_id') return row.vid ?? fixed
  if (tab === 'waiting' || tab === 'left') return row.change?.new_name ?? fixed
  return row.vid ?? fixed
}

export { changeKind, checkName, lsContext }
