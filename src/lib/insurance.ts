import type { CoverageType, AccountingPolicyTerm } from '@/types'

export const COVERAGE_TYPES: readonly CoverageType[] = ['fire_only', 'dic', 'liability', 'workers_comp', 'auto', 'umbrella', 'health', 'other']
export const COVERAGE_LABELS: Record<CoverageType, string> = {
  fire_only: 'Fire only',
  dic: 'Wrap / DIC',
  liability: 'Liability',
  workers_comp: "Workers' comp",
  auto: 'Auto',
  umbrella: 'Umbrella',
  health: 'Health',
  other: 'Other',
}
export const coverageLabel = (t: string) => (t in COVERAGE_LABELS ? COVERAGE_LABELS[t as CoverageType] : 'Other')

/** The policy year a renewal date starts: Sep 15, 2026 → "2026-27". */
export function termFor(renewal: string | null | undefined): string {
  if (!renewal) return ''
  const y = Number(renewal.slice(0, 4))
  return `${y}-${String((y + 1) % 100).padStart(2, '0')}`
}

/** The year before: "2026-27" → "2025-26". */
export function priorTerm(term: string): string {
  const y = Number(term.slice(0, 4))
  return Number.isFinite(y) ? `${y - 1}-${String(y % 100).padStart(2, '0')}` : ''
}

export function daysUntil(date: string | null | undefined, today = new Date()): number | null {
  if (!date) return null
  const d = new Date(`${date}T00:00:00`)
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((d.getTime() - t.getTime()) / 86_400_000)
}

/** The latest term on file, by label. */
export function latestTerm(terms: AccountingPolicyTerm[]): AccountingPolicyTerm | null {
  return [...terms].sort((a, b) => b.term_label.localeCompare(a.term_label))[0] ?? null
}

export function money(n: number | null | undefined): string {
  return n == null ? '' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}
