import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { OnOrderSources } from './OnOrderSources'
import type { OnOrderSource } from '@/services/ordering'

vi.mock('@/services/lines', () => ({ downloadVendorFile: vi.fn() }))

const base: OnOrderSource = { orderId: 'o1', label: 'PO LAZY92826', stage: 'placed', items: 5, from: 'our_order', paper: null, paperEmail: null, made: null, madeEmail: null, wwdLines: false }

describe('OnOrderSources', () => {
  it('links each counted order to the order, its paper and the email it came from', () => {
    render(<MemoryRouter><OnOrderSources sources={[
      { ...base, made: 'Made by Claude from the email', madeEmail: { thread_id: 't9', subject: 'Re-order Show 9-28-26', received_at: '2026-09-29T17:54:00Z' } },
      { ...base, orderId: 'o2', label: 'PO DAISY020326', stage: 'confirmed', from: 'confirmation', paper: { id: 'd1', file_name: 'conf.pdf', storage_path: 'x/conf.pdf', mime_type: 'application/pdf' }, paperEmail: { thread_id: 't2', subject: 'Order confirmation', received_at: '2026-02-05T10:00:00Z' } },
    ]} /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /PO LAZY92826/ })).toHaveAttribute('href', '/orders/o1')
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByText('Placed')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Re-order Show 9-28-26/ })).toHaveAttribute('href', '/mail/t9')
    expect(screen.getByRole('button', { name: /Confirmation/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Email it came in/ })).toHaveAttribute('href', '/mail/t2')
  })
})
