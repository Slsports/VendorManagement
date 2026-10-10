import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThreadTable } from './ThreadTable'
import type { ThreadRow } from '@/services/mail'

const { setEmailThreadStatus } = vi.hoisted(() => ({ setEmailThreadStatus: vi.fn(async () => undefined) }))
vi.mock('@/services/mail', () => ({ setEmailThreadStatus }))
// the Snooze menu needs the signed-in person; this test is about marking handled
vi.mock('@/components/shared/SnoozeButton', () => ({ SnoozeButton: () => null }))

const row = (id: string, subject: string): ThreadRow => ({
  id, gmail_thread_id: id, subject, status: 'waiting_on_us', view: 'attention', vendor_id: null, owner_id: null, message_count: 1,
  last_message_at: '2026-10-08T10:00:00Z', follow_up_at: null, vendor: null, owner: null,
  last: { from_name: 'Rep', from_email: 'rep@x.com', snippet: 'hi', direction: 'in', has_attachments: false },
})

describe('ThreadTable', () => {
  it('marks one handled from the list, and several at once', async () => {
    const onChanged = vi.fn()
    render(<MemoryRouter><ThreadTable rows={[row('a', 'Tracking update'), row('b', 'Ad'), row('c', 'Question')]} onChanged={onChanged} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: 'Mark handled: Tracking update' }))
    await waitFor(() => expect(setEmailThreadStatus).toHaveBeenCalledWith('a', 'handled'))
    fireEvent.click(screen.getByLabelText('Select Ad'))
    fireEvent.click(screen.getByLabelText('Select Question'))
    fireEvent.click(screen.getByRole('button', { name: 'Mark handled' }))
    await waitFor(() => expect(setEmailThreadStatus).toHaveBeenCalledWith('c', 'handled'))
    expect(setEmailThreadStatus).toHaveBeenCalledWith('b', 'handled')
    expect(onChanged).toHaveBeenCalledTimes(2)
  })
})
