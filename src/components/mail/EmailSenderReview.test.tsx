import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { withAuth } from '@/test/auth'
import { EmailSenderReview } from './EmailSenderReview'
import type { ReviewItem } from '@/types'

const { resolveEmailSender, listVendorNames, listRepGroupNames } = vi.hoisted(() => ({
  resolveEmailSender: vi.fn(async () => 42),
  listVendorNames: vi.fn(async () => [{ id: 'v-stan', name: 'STANSPORT', is_active: true }, { id: 'v-wfs', name: 'WORLD FAMOUS SPORTS', is_active: true }, { id: 'v-old', name: 'OLD STAN', is_active: false }]),
  listRepGroupNames: vi.fn(async () => [{ id: 'r-pin', name: 'Pinnacle Team' }]),
}))
vi.mock('@/services/mail', () => ({ resolveEmailSender, listVendorNames, listRepGroupNames, clearPickerCache: vi.fn() }))

const item = {
  id: 'ri1', organization_id: 'o1', kind: 'email_sender', entity_type: 'email_sender', entity_id: 's1', title: 'Mail from @wfsports.com looks like WORLD FAMOUS SPORTS',
  details: { sender_id: 's1', sender_key: 'wfsports.com', is_domain: true, display_name: 'Amy Lee', message_count: 42, proposed_vendor_id: 'v-wfs', proposed_vendor_name: 'WORLD FAMOUS SPORTS', proposal_note: 'named in 38 of 42 emails', samples: ['Your order'] },
  status: 'pending', created_by: null, created_at: '', resolved_by: null, resolved_at: null, resolution_note: null, assigned_to: null, assigned_at: null,
} as ReviewItem

describe('EmailSenderReview', () => {
  it('confirms the proposed vendor in one click', async () => {
    const onDone = vi.fn()
    render(withAuth('buyer', <EmailSenderReview item={item} canEdit onDone={onDone} />))
    expect(screen.getByText(/named in 38 of 42 emails/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, WORLD FAMOUS SPORTS' }))
    await waitFor(() => expect(resolveEmailSender).toHaveBeenCalledWith('s1', 'vendor', 'v-wfs', undefined))
    expect(onDone).toHaveBeenCalled()
  })
  it('files a rep group so each email is matched on its own', async () => {
    render(withAuth('buyer', <EmailSenderReview item={item} canEdit onDone={vi.fn()} />))
    fireEvent.click(screen.getByRole('button', { name: /A rep group/ }))
    await screen.findByRole('option', { name: 'Pinnacle Team' })
    fireEvent.change(screen.getByLabelText('Rep group'), { target: { value: 'r-pin' } })
    fireEvent.click(screen.getByRole('button', { name: /This rep group/ }))
    await waitFor(() => expect(resolveEmailSender).toHaveBeenCalledWith('s1', 'rep_group', undefined, 'r-pin'))
  })
  it('picks another vendor by typing; an inactive one asks to reactivate first', async () => {
    render(withAuth('buyer', <EmailSenderReview item={item} canEdit onDone={vi.fn()} />))
    fireEvent.click(screen.getByRole('button', { name: 'Another vendor' }))
    const box = screen.getByRole('combobox', { name: 'Vendor' })
    fireEvent.change(box, { target: { value: 'stan' } })
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'STANSPORT' }))
    await waitFor(() => expect(resolveEmailSender).toHaveBeenCalledWith('s1', 'vendor', 'v-stan', undefined))
    fireEvent.change(box, { target: { value: 'old' } })
    fireEvent.focus(box)
    fireEvent.mouseDown(await screen.findByRole('option', { name: /OLD STAN/ }))
    expect(await screen.findByRole('dialog', { name: 'Reactivate this vendor?' })).toBeInTheDocument()
  })
  it('names a service like Bill.com or Faire', async () => {
    render(withAuth('buyer', <EmailSenderReview item={item} canEdit onDone={vi.fn()} />))
    fireEvent.click(screen.getByRole('button', { name: 'A service like Bill.com or Faire' }))
    await waitFor(() => expect(resolveEmailSender).toHaveBeenCalledWith('s1', 'platform', undefined, undefined))
  })
  it('Marketing and Other – not a vendor', async () => {
    render(withAuth('buyer', <EmailSenderReview item={item} canEdit onDone={vi.fn()} />))
    fireEvent.click(screen.getByRole('button', { name: 'Marketing' }))
    await waitFor(() => expect(resolveEmailSender).toHaveBeenCalledWith('s1', 'marketing', undefined, undefined))
  })
  it('viewers see the proposal but no buttons', () => {
    render(withAuth('viewer', <EmailSenderReview item={item} canEdit={false} onDone={vi.fn()} />))
    expect(screen.queryByRole('button')).toBeNull()
  })
})
