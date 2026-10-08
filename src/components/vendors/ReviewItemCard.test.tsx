import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ReviewItemCard } from './ReviewItemCard'
import type { ReviewItem } from '@/types'

const { mergeVendors, unmergeVendor, confirmVendorMerge, resolveReviewItem, applyVendorRename, deleteVendor } = vi.hoisted(() => ({
  deleteVendor: vi.fn(async () => undefined),
  mergeVendors: vi.fn(async () => 'keep-id'),
  unmergeVendor: vi.fn(async () => 'new-id'),
  confirmVendorMerge: vi.fn(async () => undefined),
  resolveReviewItem: vi.fn(async () => undefined),
  applyVendorRename: vi.fn(async () => undefined),
}))
vi.mock('@/services/vendors', () => ({ mergeVendors, unmergeVendor, confirmVendorMerge, resolveReviewItem, applyVendorRename, deleteVendor }))

const base: ReviewItem = {
  id: 'item-1', organization_id: 'org', kind: 'vendor_duplicate', entity_type: 'vendor', entity_id: 'a', title: 'Possible duplicate: "Crosman" and "Crossman"',
  details: { other_vendor_id: 'b', other_name: 'Crossman', reason: 'Very similar names' }, status: 'pending', created_by: null, created_at: '2026-10-05T00:00:00Z', resolved_by: null, resolved_at: null, resolution_note: null, assigned_to: null, assigned_at: null,
}
const a = { id: 'a', name: 'Crosman', lightspeed_name: 'CROSMAN - WWD', aliases: ['CROSMAN - WWD'] }
const b = { id: 'b', name: 'Crossman', lightspeed_name: 'CROSSMAN', aliases: ['CROSSMAN'] }

function renderCard(item: ReviewItem, onDone = vi.fn()) {
  render(<MemoryRouter><ReviewItemCard item={item} vendor={a} other={b} canEdit onDone={onDone} /></MemoryRouter>)
  return onDone
}

describe('ReviewItemCard', () => {
  it('possible duplicate: "Keep both" rejects the item without merging', async () => {
    const onDone = renderCard(base)
    fireEvent.click(screen.getByRole('button', { name: /keep both/i }))
    await waitFor(() => expect(resolveReviewItem).toHaveBeenCalledWith('item-1', 'rejected', 'Keep both'))
    expect(mergeVendors).not.toHaveBeenCalled()
    expect(onDone).toHaveBeenCalled()
  })

  it('possible duplicate: merge lets you pick the survivor and the route', async () => {
    const onDone = renderCard(base)
    fireEvent.click(screen.getByRole('button', { name: /same vendor, merge/i }))
    fireEvent.click(screen.getByLabelText(/Crossman \(CROSSMAN\)/))
    fireEvent.change(screen.getByLabelText('Billing route for the result'), { target: { value: 'faire' } })
    fireEvent.click(screen.getByRole('button', { name: /merge now/i }))
    await waitFor(() => expect(mergeVendors).toHaveBeenCalledWith('b', 'a', 'faire'))
    expect(onDone).toHaveBeenCalledWith('keep-id')
  })

  it('import merge: confirm passes the chosen route; split names a Lightspeed alias', async () => {
    const item: ReviewItem = { ...base, id: 'item-2', kind: 'vendor_merge', details: { lightspeed_names: ['CROSMAN - WWD', 'CROSMAN'] } }
    renderCard(item)
    fireEvent.change(screen.getByLabelText('Billing route for the result'), { target: { value: 'worldwide' } })
    fireEvent.click(screen.getByRole('button', { name: /yes, one vendor/i }))
    await waitFor(() => expect(confirmVendorMerge).toHaveBeenCalledWith('a', 'worldwide'))

    fireEvent.click(screen.getByRole('button', { name: /no, split one out/i }))
    fireEvent.change(screen.getByLabelText('Lightspeed name to split out'), { target: { value: 'CROSMAN - WWD' } })
    fireEvent.click(screen.getByRole('button', { name: /split it out/i }))
    await waitFor(() => expect(unmergeVendor).toHaveBeenCalledWith('a', 'CROSMAN - WWD', null))
  })

  it('name clean-up: the proposed name can be edited before applying, or kept as is', async () => {
    const item: ReviewItem = { ...base, id: 'item-3', kind: 'vendor_rename', details: { current_name: 'POLAR MAGNETICS - Maryellen', new_name: 'POLAR MAGNETICS', alias: null, rep_group_name: 'Maryellen Reynolds' } }
    renderCard(item)
    expect(screen.getByText(/Maryellen Reynolds/)).toBeInTheDocument()
    const input = screen.getByLabelText('Vendor name') as HTMLInputElement
    expect(input.value).toBe('POLAR MAGNETICS')
    fireEvent.change(input, { target: { value: 'Polar Magnetics' } })
    fireEvent.click(screen.getByRole('button', { name: /use this name/i }))
    await waitFor(() => expect(applyVendorRename).toHaveBeenCalledWith('item-3', 'Polar Magnetics'))
    fireEvent.click(screen.getByRole('button', { name: /keep as is/i }))
    await waitFor(() => expect(resolveReviewItem).toHaveBeenCalledWith('item-3', 'rejected', 'Keep name'))
  })

  it('hides every action for viewers', () => {
    render(<MemoryRouter><ReviewItemCard item={base} vendor={a} other={b} canEdit={false} onDone={vi.fn()} /></MemoryRouter>)
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByRole('link', { name: 'Open Crosman' })).toHaveAttribute('href', '/vendors/a')
  })
  it('a name clean-up that is not a vendor can be deleted after a confirm', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const onDone = renderCard({ ...base, kind: 'vendor_rename', details: { current_name: 'SLS INTERNAL', new_name: 'SLS Internal' } })
    fireEvent.click(screen.getByRole('button', { name: /not a vendor, delete it/i }))
    await waitFor(() => expect(deleteVendor).toHaveBeenCalledWith('a'))
    expect(onDone).toHaveBeenCalled()
  })

  it('possible duplicates offer merge, not delete', () => {
    renderCard(base)
    expect(screen.queryByRole('button', { name: /delete it/i })).toBeNull()
  })
})
