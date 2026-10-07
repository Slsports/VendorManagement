import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { withAuth } from '@/test/auth'
import { VendorAssignmentActions } from './VendorAssignmentActions'

const { listOrderers, setVendorAssignee } = vi.hoisted(() => ({
  listOrderers: vi.fn(async () => [
    { id: 'dana', full_name: 'Dana Powell', email: 'd@x.com', role: 'admin' },
    { id: 'jw', full_name: 'Jarrett', email: 'j@x.com', role: 'manager' },
  ]),
  setVendorAssignee: vi.fn(async () => undefined),
}))
vi.mock('@/services/reviews', () => ({ listOrderers }))
vi.mock('@/services/vendors', () => ({ setVendorAssignee }))

describe('VendorAssignmentActions', () => {
  it('keeps the proposed person with one click', async () => {
    const onDone = vi.fn()
    render(withAuth('admin', <VendorAssignmentActions vendorId="v1" proposedId="jw" onDone={onDone} />))
    fireEvent.click(await screen.findByRole('button', { name: 'Keep Jarrett' }))
    await waitFor(() => expect(setVendorAssignee).toHaveBeenCalledWith('v1', 'jw'))
    expect(onDone).toHaveBeenCalled()
  })

  it('assigns someone else who places orders', async () => {
    render(withAuth('admin', <VendorAssignmentActions vendorId="v1" proposedId="jw" onDone={vi.fn()} />))
    await screen.findByRole('option', { name: 'Dana Powell' })
    fireEvent.change(screen.getByLabelText('Who orders from this vendor'), { target: { value: 'dana' } })
    fireEvent.click(screen.getByRole('button', { name: 'Assign' }))
    await waitFor(() => expect(setVendorAssignee).toHaveBeenCalledWith('v1', 'dana'))
  })
})
