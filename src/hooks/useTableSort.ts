import { useSearchParams } from 'react-router-dom'

export type SortValue = string | number | boolean | Date | null | undefined
export type SortDir = 'asc' | 'desc'
export interface SortState<K extends string> { key: K; dir: SortDir }

/** Nulls and blanks always last; numbers numerically; text A–Z ignoring case, with "Item 2" before "Item 10". */
export function compareValues(a: SortValue, b: SortValue): number {
  const blank = (v: SortValue) => v === null || v === undefined || v === '' || (typeof v === 'number' && Number.isNaN(v))
  if (blank(a) || blank(b)) return blank(a) === blank(b) ? 0 : blank(a) ? 1 : -1
  if (a instanceof Date || b instanceof Date) return new Date(a as Date).getTime() - new Date(b as Date).getTime()
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return a === b ? 0 : a ? -1 : 1
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

export function sortRows<T, K extends string>(rows: readonly T[], columns: Record<K, (row: T) => SortValue>, sort: SortState<K> | null): T[] {
  if (!sort || !columns[sort.key]) return [...rows]
  const get = columns[sort.key]
  const sign = sort.dir === 'asc' ? 1 : -1
  return rows
    .map((row, i) => ({ row, i, v: get(row) }))
    .sort((x, y) => {
      const blankX = x.v === null || x.v === undefined || x.v === ''
      const blankY = y.v === null || y.v === undefined || y.v === ''
      if (blankX !== blankY) return blankX ? 1 : -1 // blanks stay at the bottom either way
      return sign * compareValues(x.v, y.v) || x.i - y.i
    })
    .map((x) => x.row)
}

/** First click sorts ascending (descending for columns listed as `descFirst`), the next click reverses. */
export function nextSort<K extends string>(current: SortState<K> | null, key: K, descFirst: readonly K[] = []): SortState<K> {
  if (current?.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: descFirst.includes(key) ? 'desc' : 'asc' }
}

export function parseSort<K extends string>(raw: string | null, keys: readonly K[]): SortState<K> | null {
  if (!raw) return null
  const dir: SortDir = raw.startsWith('-') ? 'desc' : 'asc'
  const key = raw.replace(/^-/, '') as K
  return keys.includes(key) ? { key, dir } : null
}

/**
 * One sort for every list (screen rules, Oct 7). The sort lives in the address bar (`?sort=name`,
 * `?sort=-cost`) so Back returns to the list sorted as you left it. With no sort chosen the rows keep
 * the order they arrived in, which is each page's default.
 */
export function useTableSort<T, K extends string>(
  rows: readonly T[],
  columns: Record<K, (row: T) => SortValue>,
  options: { param?: string; descFirst?: readonly NoInfer<K>[] } = {},
) {
  const param = options.param ?? 'sort'
  const [params, setParams] = useSearchParams()
  const keys = Object.keys(columns) as K[]
  const raw = params.get(param)
  const sort = parseSort(raw, keys)
  const sorted = sortRows(rows, columns, sort)

  function setSort(next: SortState<K> | null) {
    const p = new URLSearchParams(params)
    if (next) p.set(param, `${next.dir === 'desc' ? '-' : ''}${next.key}`)
    else p.delete(param)
    setParams(p, { replace: true })
  }

  return {
    sorted,
    sort,
    setSort,
    toggle: (key: K) => setSort(nextSort(sort, key, options.descFirst)),
  }
}
