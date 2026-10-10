import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { withAuth } from '@/test/auth'
import { DeliveryReceiptReview } from './DeliveryReceiptReview'
import type { ReviewItem } from '@/types'

const { fileDeliveryReceipt, listVendorNames } = vi.hoisted(() => ({
  fileDeliveryReceipt: vi.fn(async () => undefined),
  listVendorNames: vi.fn(async () => [{ id: 'v-rd', name: 'ROYAL DELUXE ACCESSORIES', is_active: true }, { id: 'v-rb', name: 'ROYAL BRUSH', is_active: true }]),
}))
vi.mock('@/services/freight', () => ({ fileDeliveryReceipt }))
vi.mock('@/services/mail', () => ({ listVendorNames, clearPickerCache: vi.fn() }))

const item = {
  id: 'ri1', organization_id: 'o1', kind: 'delivery_receipt', entity_type: 'delivery_receipt', entity_id: 'd1', title: 'Delivery receipt 518-563231: which vendor shipped it?',
  details: { carrier: 'XPO', pro_number: '518-563231', shipper_name: 'ROYAL DELUXE ACCESSORIES LLC', po_numbers: ['60851'], delivered_on: '2026-09-14', thread_id: 't1' },
  status: 'pending', created_by: null, created_at: '', resolved_by: null, resolved_at: null, resolution_note: null, assigned_to: null, assigned_at: null,
} as ReviewItem

describe('DeliveryReceiptReview', () => {
  it('shows what the receipt says and files it to the picked vendor', async () => {
    const onDone = vi.fn()
    render(withAuth('buyer', <DeliveryReceiptReview item={item} canEdit onDone={onDone} />))
    expect(screen.getByText('ROYAL DELUXE ACCESSORIES LLC')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open the email/ })).toHaveAttribute('href', '/mail/t1')
    const box = screen.getByRole('combobox', { name: 'Vendor' })
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'deluxe' } })
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'ROYAL DELUXE ACCESSORIES' }))
    await waitFor(() => expect(fileDeliveryReceipt).toHaveBeenCalledWith('d1', 'v-rd'))
    expect(onDone).toHaveBeenCalled()
  })
})
