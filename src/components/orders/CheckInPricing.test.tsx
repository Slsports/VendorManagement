import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { withAuth } from '@/test/auth'
import { CheckInPricing } from './CheckInPricing'
import type { OrderDetail } from '@/services/orders'

const { listOrderLines } = vi.hoisted(() => ({
  listOrderLines: vi.fn(async () => [
    { id: 'l1', order_id: 'o1', organization_id: 'o1', sort_order: 0, vendor_item_id: 'TOY-1', description: 'Bouncy ball', quantity: 100, unit_cost: 5, extended: 500, retail_price: null, retail_edited: false, notes: null, created_at: '', updated_at: '' },
    { id: 'l2', order_id: 'o1', organization_id: 'o1', sort_order: 1, vendor_item_id: 'TOY-2', description: 'Kite', quantity: 50, unit_cost: 10, extended: 500, retail_price: 25, retail_edited: true, notes: null, created_at: '', updated_at: '' },
  ]),
}))
vi.mock('@/services/orders', () => ({ listOrderLines, addOrderLines: vi.fn(), updateOrderLine: vi.fn(), deleteOrderLine: vi.fn() }))

const order = (freight: number | null) => ({
  id: 'o1', billing_route: 'worldwide', free_shipping: false, freight_cost: freight, final_cost: null, est_cost: null,
  vendor: { id: 'v1', name: 'Toy Co', wwd_zero_upcharge: false, vendor_billing_routes: [{ route: 'worldwide' }] },
}) as unknown as OrderDetail

describe('CheckInPricing', () => {
  it('shows where freight landed and the exact price: $5 at 66.5% is $14.93; a hand-set price stays', async () => {
    render(withAuth('manager', <CheckInPricing order={order(100)} canEdit />))
    expect(await screen.findByDisplayValue('14.93')).toBeInTheDocument()
    expect(screen.getByText('Freight 10%')).toBeInTheDocument()
    expect(screen.getByText('Total 66.5%')).toBeInTheDocument()
    expect(screen.getByDisplayValue('25.00')).toBeInTheDocument()
  })
  it('says when the freight bill is not in yet and prices on margin and upcharge', async () => {
    render(withAuth('manager', <CheckInPricing order={order(null)} canEdit />))
    expect(await screen.findByText('Freight not billed yet')).toBeInTheDocument()
    expect(screen.getByText('Total 56.5%')).toBeInTheDocument()
    expect(screen.getByDisplayValue('11.49')).toBeInTheDocument()
  })
})
