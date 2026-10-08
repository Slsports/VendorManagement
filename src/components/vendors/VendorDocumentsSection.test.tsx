import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { withAuth } from '@/test/auth'
import { VendorDocumentsSection } from './VendorDocumentsSection'

const base = { organization_id: 'o1', vendor_id: 'v1', line_id: null, url: null, file_size: 1000, mime_type: 'application/pdf', source: 'email', notes: null, created_by: null, created_at: '', order_id: null, email_id: null, email: null, season_label: null }
const { moveVendorDocument } = vi.hoisted(() => ({ moveVendorDocument: vi.fn(async () => undefined) }))
vi.mock('@/services/lines', () => ({
  listVendorLinks: vi.fn(async () => [
    { ...base, id: 'd1', kind: 'invoice', label: 'INV 802289', storage_path: 'p1', file_name: 'INV_802289.pdf', received_at: '2026-04-01', doc_year: 2026, is_current: false },
    { ...base, id: 'd2', kind: 'invoice', label: 'INV 647107', storage_path: 'p2', file_name: 'INV_647107.pdf', received_at: '2023-08-21', doc_year: 2023, is_current: false },
    { ...base, id: 'd3', kind: 'price_list', label: 'Fall 2026 price list', storage_path: 'p3', file_name: 'pl.pdf', received_at: '2026-08-01', doc_year: 2026, is_current: true },
  ]),
  moveVendorDocument, addVendorLink: vi.fn(), deleteVendorLink: vi.fn(), downloadVendorFile: vi.fn(), zipVendorDocuments: vi.fn(), uploadVendorFile: vi.fn(),
}))

describe('VendorDocumentsSection', () => {
  it('shows folders with counts, years inside, and moves a file', async () => {
    render(withAuth('buyer', <VendorDocumentsSection vendorId="v1" vendorName="Stansport" organizationId="o1" userId="u1" canEdit />))
    const invoices = await screen.findByRole('button', { name: /Invoices\s*2 files/ })
    expect(screen.getByRole('button', { name: /Price lists\s*1 file/ })).toBeInTheDocument()
    fireEvent.click(invoices)
    expect(screen.getByText('2026', { exact: false, selector: 'summary' })).toBeInTheDocument()
    expect(screen.getByText('2023', { exact: false, selector: 'summary' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Move INV 802289' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Folder'), { target: { value: 'shipping' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }))
    await waitFor(() => expect(moveVendorDocument).toHaveBeenCalledWith('d1', 'packing_slip', 2026))
  })
})
