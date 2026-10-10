import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FreeShippingCard } from './FreeShippingCard'

const { updateOrder } = vi.hoisted(() => ({ updateOrder: vi.fn(async () => ({})) }))
vi.mock('@/services/orders', () => ({ updateOrder }))

const order = { id: 'o1', free_shipping: null, free_shipping_basis: null, free_shipping_note: null, freight_cost: null, freight_notes: null, est_cost: 640, final_cost: null }

describe('FreeShippingCard', () => {
  it('shows the vendor rule and saves yes with a basis', async () => {
    const onChange = vi.fn()
    render(<FreeShippingCard order={order} vendor={{ free_shipping_policy: 'sometimes', free_shipping_threshold: 500, freight_program: null, freight_routing: 'UPS Ground collect' }} canEdit onChange={onChange} />)
    expect(screen.getByText(/Free shipping over \$500/)).toBeInTheDocument()
    expect(screen.getByText('UPS Ground collect')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Free shipping on this order'), { target: { value: 'yes' } })
    fireEvent.change(screen.getByLabelText('Why it ships free'), { target: { value: 'show_special' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(updateOrder).toHaveBeenCalledWith('o1', { free_shipping: true, free_shipping_basis: 'show_special', free_shipping_note: null }))
    expect(onChange).toHaveBeenCalled()
  })

  it('warns when a never-free vendor is marked free, and when an order over the threshold is not', () => {
    const { rerender } = render(<FreeShippingCard order={order} vendor={{ free_shipping_policy: 'never', free_shipping_threshold: null, freight_program: null, freight_routing: null }} canEdit onChange={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Free shipping on this order'), { target: { value: 'yes' } })
    expect(screen.getByText(/never offers free shipping/)).toBeInTheDocument()
    rerender(<FreeShippingCard order={order} vendor={{ free_shipping_policy: 'sometimes', free_shipping_threshold: 500, freight_program: null, freight_routing: null }} canEdit onChange={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Free shipping on this order'), { target: { value: 'no' } })
    expect(screen.getByText(/should have shipped free/)).toBeInTheDocument()
  })
})
