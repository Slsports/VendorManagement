import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { withAuth } from '@/test/auth'
import { CarrierDialog } from './CarrierDialog'
import type { Carrier } from '@/types'

const { createCarrier, updateCarrier } = vi.hoisted(() => ({
  createCarrier: vi.fn(async (c: Partial<Carrier>) => ({ id: 'c-new', ...c })),
  updateCarrier: vi.fn(async (id: string, c: Partial<Carrier>) => ({ id, ...c })),
}))
vi.mock('@/services/freight', () => ({
  createCarrier, updateCarrier,
  listCarrierOwners: vi.fn(async () => [{ id: 'p-dana', full_name: 'Dana Powell' }, { id: 'p-trevor', full_name: 'Trevor Jenkins' }]),
  listCarriers: vi.fn(async () => [{ id: 'c1', name: 'XPO', owner_id: 'p-trevor' }]),
}))

describe('CarrierDialog', () => {
  it('adds a carrier with its email domains; its mail goes to Trevor by default', async () => {
    const onDone = vi.fn()
    render(withAuth('buyer', <CarrierDialog onClose={vi.fn()} onDone={onDone} />))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Estes' } })
    fireEvent.click(screen.getByLabelText('LTL'))
    fireEvent.change(screen.getByLabelText(/Email domains/), { target: { value: 'estes-express.com, @estes.com' } })
    await waitFor(() => expect(screen.getByLabelText('Its mail goes to')).toHaveValue('p-trevor'))
    fireEvent.click(screen.getByRole('button', { name: 'Add carrier' }))
    await waitFor(() => expect(createCarrier).toHaveBeenCalledWith(expect.objectContaining({ name: 'Estes', mode: 'ltl', email_domains: ['estes-express.com', 'estes.com'], owner_id: 'p-trevor' })))
    expect(onDone).toHaveBeenCalled()
  })
  it('edits a carrier and can retire it', async () => {
    const xpo = { id: 'c1', organization_id: 'o1', name: 'XPO', mode: 'ltl', email_domains: ['xpo.com'], website: null, account_number: null, owner_id: 'p-trevor', notes: null, is_active: true, created_at: '' } as Carrier
    render(withAuth('buyer', <CarrierDialog carrier={xpo} onClose={vi.fn()} onDone={vi.fn()} />))
    fireEvent.click(screen.getByLabelText(/Active/))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(updateCarrier).toHaveBeenCalledWith('c1', expect.objectContaining({ email_domains: ['xpo.com'], is_active: false })))
  })
})
