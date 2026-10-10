import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { compareValues, nextSort, parseSort, sortRows, useTableSort } from './useTableSort'
import { SortHeader } from '@/components/shared/SortHeader'

const rows = [
  { name: 'item 10', cost: 5, paid: null as string | null },
  { name: 'Item 2', cost: null as number | null, paid: '2026-03-01' },
  { name: 'apple', cost: 20, paid: '2025-12-01' },
]
const cols = { name: (r: (typeof rows)[number]) => r.name, cost: (r: (typeof rows)[number]) => r.cost, paid: (r: (typeof rows)[number]) => r.paid }

describe('sorting rules', () => {
  it('sorts text ignoring case with numbers in order, and keeps blanks last both ways', () => {
    expect(sortRows(rows, cols, { key: 'name', dir: 'asc' }).map((r) => r.name)).toEqual(['apple', 'Item 2', 'item 10'])
    expect(sortRows(rows, cols, { key: 'cost', dir: 'asc' }).map((r) => r.cost)).toEqual([5, 20, null])
    expect(sortRows(rows, cols, { key: 'cost', dir: 'desc' }).map((r) => r.cost)).toEqual([20, 5, null])
    expect(sortRows(rows, cols, { key: 'paid', dir: 'desc' }).map((r) => r.paid)).toEqual(['2026-03-01', '2025-12-01', null])
  })
  it('leaves the default order alone with no sort', () => {
    expect(sortRows(rows, cols, null)).toEqual(rows)
  })
  it('clicking again reverses; date and money columns start newest/largest first', () => {
    expect(nextSort(null, 'name')).toEqual({ key: 'name', dir: 'asc' })
    expect(nextSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' })
    expect(nextSort({ key: 'name', dir: 'desc' }, 'cost', ['cost'])).toEqual({ key: 'cost', dir: 'desc' })
  })
  it('reads the sort from the address bar and ignores unknown columns', () => {
    expect(parseSort('-cost', ['cost', 'name'])).toEqual({ key: 'cost', dir: 'desc' })
    expect(parseSort('bogus', ['cost'])).toBeNull()
    expect(compareValues(true, false)).toBeLessThan(0)
  })
})

function Table() {
  const { sorted, sort, toggle } = useTableSort(rows, cols)
  const loc = useLocation()
  return (
    <>
      <table><thead><tr><SortHeader label="Name" sortKey="name" sort={sort} onSort={toggle} /></tr></thead>
        <tbody>{sorted.map((r) => <tr key={r.name}><td>{r.name}</td></tr>)}</tbody></table>
      <p data-testid="search">{loc.search}</p>
    </>
  )
}

describe('useTableSort + SortHeader', () => {
  it('sorts on header click, reverses on the second, and keeps the sort in the address bar', () => {
    render(<MemoryRouter initialEntries={['/vendors?route=worldwide']}><Table /></MemoryRouter>)
    const header = screen.getByRole('button', { name: /Name/ })
    fireEvent.click(header)
    expect(screen.getAllByRole('cell').map((c) => c.textContent)).toEqual(['apple', 'Item 2', 'item 10'])
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getByTestId('search').textContent).toBe('?route=worldwide&sort=name')
    fireEvent.click(header)
    expect(screen.getAllByRole('cell').map((c) => c.textContent)).toEqual(['item 10', 'Item 2', 'apple'])
    expect(screen.getByRole('columnheader')).toHaveAttribute('aria-sort', 'descending')
  })
})
