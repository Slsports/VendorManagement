import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { withAuth } from '@/test/auth'
import { MailReplyReview } from './MailReplyReview'
import type { ReviewItem } from '@/types'

const { answerMailReply } = vi.hoisted(() => ({ answerMailReply: vi.fn(async () => undefined) }))
vi.mock('@/services/mail', () => ({ answerMailReply }))

const item = {
  id: 'ri1', organization_id: 'o1', kind: 'mail_reply', entity_type: 'email_thread', entity_id: 't1', title: 'Does this need an answer? Account notice',
  details: { thread_id: 't1', from: 'Bill.com', snippet: 'Your statement is ready', note: 'A statement notice; maybe nothing to do' },
  status: 'pending', created_by: null, created_at: '', resolved_by: null, resolved_at: null, resolution_note: null, assigned_to: null, assigned_at: null,
} as ReviewItem

describe('MailReplyReview', () => {
  it('shows the email and Claude\'s note; No answer needed handles it', async () => {
    const onDone = vi.fn()
    render(withAuth('buyer', <MailReplyReview item={item} canEdit onDone={onDone} />))
    expect(screen.getByText('Your statement is ready')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open the email/ })).toHaveAttribute('href', '/mail/t1')
    fireEvent.click(screen.getByRole('button', { name: 'No answer needed' }))
    await waitFor(() => expect(answerMailReply).toHaveBeenCalledWith('ri1', false))
    expect(onDone).toHaveBeenCalled()
  })
})
