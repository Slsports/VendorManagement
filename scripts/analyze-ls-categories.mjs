#!/usr/bin/env node
/**
 * Read a Lightspeed item export and category export and report where the category tree lacks
 * the size / gender-age breakdowns Dana wants (and where items sit above a breakdown that exists).
 *
 *   node scripts/analyze-ls-categories.mjs --items items.xlsx --categories categories.xlsx [--min 5] [--json out.json]
 */
import XLSX from 'xlsx'
import fs from 'node:fs'
import { parseArgs, die } from './lib/match.mjs'

const args = parseArgs(process.argv.slice(2))
if (!args.items || !args.categories) die('--items and --categories are required')
const MIN = Number(args.min || 5)

// ---- category tree ----
const catRows = XLSX.utils.sheet_to_json(XLSX.readFile(args.categories).Sheets[XLSX.readFile(args.categories).SheetNames[0]], { header: 1, defval: '', raw: false }).slice(1).map((r) => String(r[0]))
const nodes = new Map()   // path -> { path, name, depth, children:[], items:0, itemsDeep:0, examples:[] }
const stack = []
for (const s of catRows) {
  const depth = (s.match(/--/g) || []).length
  const name = s.replace(/^[\s\->]+/, '').trim()
  if (!name) continue
  stack.length = depth; stack[depth] = name
  const path = stack.slice(0, depth + 1).join(' > ')
  nodes.set(path, { path, name, depth, children: [], items: 0, itemsDeep: 0, examples: [] })
  if (depth > 0) nodes.get(stack.slice(0, depth).join(' > '))?.children.push(path)
}

// ---- items ----
const items = XLSX.utils.sheet_to_json(XLSX.readFile(args.items).Sheets[XLSX.readFile(args.items).SheetNames[0]], { defval: '', raw: false })
const LEVELS = ['Category', 'Subcategory 1', 'Subcategory 2', 'Subcategory 3', 'Subcategory 4', 'Subcategory 5', 'Subcategory 6', 'Subcategory 7', 'Subcategory 8', 'Subcategory 9']
let unknownPath = 0, uncategorized = 0
for (const it of items) {
  if (it['Tax Class'] && it['Tax Class'] !== 'Item') continue   // labor, gift cards etc
  const segs = LEVELS.map((k) => String(it[k]).trim()).filter(Boolean)
  if (!segs.length) { uncategorized++; continue }
  const path = segs.join(' > ')
  let n = nodes.get(path)
  if (!n) { unknownPath++; n = { path, name: segs[segs.length - 1], depth: segs.length - 1, children: [], items: 0, itemsDeep: 0, examples: [], orphan: true }; nodes.set(path, n) }
  n.items++
  if (n.examples.length < 4) n.examples.push(String(it['Item']))
  for (let d = 1; d < segs.length; d++) { const p = nodes.get(segs.slice(0, d).join(' > ')); if (p) p.itemsDeep++ }
  n.itemsDeep++
}

// ---- vocabularies learned from the tree itself ----
const SIZE = /^(xs|s|m|l|xl|xxl|xxxl|[2-6]xl(\s*\(.*\))?|sm|md|lg|small|medium|large|x-?large|one size|\d{1,2}(\.\d)?|\d{1,2}[-/]\d{1,2}|\d{1,2}t|\d{1,2}\/\d{1,2}t|\d{1,2}m|\d{1,2}-\d{1,2}m|\d+ ?(month|mo|qt|quart|oz|lb|lbs|gal|person|man|p|ft|in|inch|cm|mm|l|liter)s?|(small|medium|large|xs|xl|[2-6]xl)\s*\(.*\)|(large|medium|small)\s+\d.*|child.*lbs?|adult.*lbs?|.*\d+\s*-\s*\d+\s*lbs?)$/i
const GENDER = /^(mens|men's|men|womens|women's|women|ladies|boys|girls|kids|kid|youth|toddler|infant|baby|adult|unisex|juniors|junior|toddler-infant|adult unisex|youth unisex|boys youth|girls youth|kids-infants)$/i
const kind = (name) => (GENDER.test(name) ? 'gender' : SIZE.test(name) ? 'size' : null)
const ITEM_SIZE = /\b(xs|sm|md|lg|xl|xxl|[2-6]xl|small|medium|large|x-large|\d{1,2}t|\d{1,2}m(onths?)?|\d{1,2}-\d{1,2}(m|y)?|\d+ ?(qt|quart|oz|lbs?|gal|person|man|ft|'|in|cm|mm))\b/i
const ITEM_GENDER = /\b(mens|men's|men|womens|women's|women|ladies|boys|girls|kids?|youth|toddler|infant|baby|adult|unisex|juniors?)\b/i

const report = { roots: [], needSize: [], needGender: [], aboveBreakdown: [], mixedNaming: [], orphans: [] }
for (const [path, n] of nodes) {
  if (n.depth === 0) report.roots.push({ name: n.name, items: n.itemsDeep })
  if (n.orphan) report.orphans.push({ path, items: n.items })
  const childKinds = n.children.map((c) => kind(nodes.get(c).name)).filter(Boolean)
  const hasSizeKids = childKinds.includes('size'), hasGenderKids = childKinds.includes('gender')
  const k = kind(n.name)
  // items sitting on a node that has size/gender children (should be in one of them)
  if (n.items >= 1 && (hasSizeKids || hasGenderKids) && n.items >= Math.min(MIN, 3)) report.aboveBreakdown.push({ path, items: n.items, breakdown: hasSizeKids ? 'size' : 'gender', examples: n.examples })
  // leaf-ish category whose items carry sizes/genders in their names but no breakdown exists
  if (k !== 'size' && !hasSizeKids && n.items >= MIN) {
    const allItems = items.filter((it) => LEVELS.map((x) => String(it[x]).trim()).filter(Boolean).join(' > ') === path).map((it) => String(it['Item']))
    const sized = allItems.filter((s) => ITEM_SIZE.test(s) && !/\b\d+ ?(oz|qt|pk|pc|ct)\b/i.test(s) || /\b(xs|sm|md|lg|xl|[2-6]xl|small|medium|large|\d{1,2}t)\b/i.test(s))
    const gendered = allItems.filter((s) => ITEM_GENDER.test(s))
    if (sized.length >= Math.max(MIN, allItems.length * 0.3)) report.needSize.push({ path, items: n.items, sized: sized.length, examples: sized.slice(0, 4) })
    if (!hasGenderKids && k !== 'gender' && !/gender|mens|womens/.test(path.toLowerCase()) && gendered.length >= Math.max(MIN, allItems.length * 0.3)) report.needGender.push({ path, items: n.items, gendered: gendered.length, examples: gendered.slice(0, 4) })
  }
  // size naming styles under one parent
  if (hasSizeKids) {
    const styles = new Set(n.children.map((c) => nodes.get(c).name).filter((nm) => SIZE.test(nm)).map((nm) => (/^(sm|md|lg)$/i.test(nm) ? 'SM/MD/LG' : /^(small|medium|large)/i.test(nm) ? 'SMALL/MEDIUM/LARGE' : /\(/.test(nm) ? 'with-range' : 'other')))
    if (styles.size > 1) report.mixedNaming.push({ path, styles: [...styles] })
  }
}
report.roots.sort((a, b) => b.items - a.items)
report.needSize.sort((a, b) => b.items - a.items); report.needGender.sort((a, b) => b.items - a.items); report.aboveBreakdown.sort((a, b) => b.items - a.items)
report.meta = { categories: nodes.size, items: items.length, uncategorized, unknownPath, sizeStyles: {} }
// size naming census across the whole tree
const census = {}
for (const [, n] of nodes) if (kind(n.name) === 'size') { const key = /^(sm|md|lg)$/i.test(n.name) ? 'SM/MD/LG' : /^(small|medium|large)$/i.test(n.name) ? 'SMALL/MEDIUM/LARGE' : /^(small|medium|large|xs|xl|[2-6]xl)\s*\(/i.test(n.name) ? 'SIZE (range)' : /^[2-6]xl$/i.test(n.name) ? 'nXL' : /^(xs|xl)$/i.test(n.name) ? 'XS/XL' : /t$/i.test(n.name) ? 'toddler T' : /m$|month/i.test(n.name) ? 'infant months' : /^\d/.test(n.name) ? 'numeric' : 'other'; census[key] = (census[key] || 0) + 1 }
report.meta.sizeStyles = census
if (args.json) fs.writeFileSync(args.json, JSON.stringify(report, null, 1))

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0)
console.log(`categories ${report.meta.categories} | items ${report.meta.items} (uncategorized ${uncategorized}, on a path not in the category export ${unknownPath})`)
console.log('ROOTS: ' + report.roots.map((r) => `${r.name} ${r.items}`).join(' | '))
console.log('SIZE NAMING IN THE TREE: ' + Object.entries(census).map(([k, v]) => `${k} ${v}`).join(', '))
console.log(`\nNEED A SIZE BREAKDOWN (${report.needSize.length}; items carry sizes in their names, no size categories under them):`)
for (const r of report.needSize.slice(0, 60)) console.log(`  ${r.path}  [${r.items} items, ${pct(r.sized, r.items)}% sized]  e.g. ${r.examples.slice(0, 2).join(' / ')}`)
console.log(`\nNEED A GENDER/AGE BREAKDOWN (${report.needGender.length}):`)
for (const r of report.needGender.slice(0, 40)) console.log(`  ${r.path}  [${r.items} items, ${pct(r.gendered, r.items)}% gendered]  e.g. ${r.examples.slice(0, 2).join(' / ')}`)
console.log(`\nITEMS SITTING ABOVE AN EXISTING BREAKDOWN (${report.aboveBreakdown.length}):`)
for (const r of report.aboveBreakdown.slice(0, 40)) console.log(`  ${r.path}  [${r.items} items above its ${r.breakdown} categories]  e.g. ${r.examples.slice(0, 2).join(' / ')}`)
console.log(`\nMIXED SIZE NAMING UNDER ONE PARENT (${report.mixedNaming.length}):`)
for (const r of report.mixedNaming.slice(0, 30)) console.log(`  ${r.path}: ${r.styles.join(' + ')}`)
console.log(`\nITEM PATHS NOT IN THE CATEGORY EXPORT (${report.orphans.length}):`)
for (const r of report.orphans.slice(0, 15)) console.log(`  ${r.path} [${r.items}]`)
