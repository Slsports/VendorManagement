import { describe, expect, it } from 'vitest'
import { threadState, waited } from './mail'

describe('mail helpers', () => {
  const now = new Date('2026-10-08T12:00:00Z').getTime()
  it('reads a thread waiting past its follow-up date as no answer yet', () => {
    expect(threadState({ status: 'waiting_on_vendor', follow_up_at: '2026-10-07T00:00:00Z' }, now)).toBe('no_answer')
    expect(threadState({ status: 'waiting_on_vendor', follow_up_at: '2026-10-10T00:00:00Z' }, now)).toBe('waiting')
    expect(threadState({ status: 'waiting_on_us', follow_up_at: null }, now)).toBe('needs')
    expect(threadState({ status: 'handled', follow_up_at: null }, now)).toBe('handled')
  })
  it('says how long something waited', () => {
    expect(waited('2026-10-08T11:30:00Z', now)).toBe('30 min')
    expect(waited('2026-10-07T12:00:00Z', now)).toBe('24 hours')
    expect(waited('2026-10-03T12:00:00Z', now)).toBe('5 days')
  })
})

import { followUpDraft, forwardDraft, replyDraft } from './mail'

describe('drafts', () => {
  const t = { id: 't1', vendor_id: 'v1', subject: 'Order 55' }
  const incoming = { id: 'e1', direction: 'in' as const, from_email: 'amy@wfs.com', from_name: 'Amy', to_emails: ['orders@sls.com', 'bob@wfs.com'], cc_emails: ['dana@sls.com'], subject: 'Order 55', body_text: 'Shipped today.', snippet: null, received_at: '2026-10-08T12:00:00Z' }
  it('replies to the sender, reply all adds everyone else but us', () => {
    expect(replyDraft(t, incoming, 'orders@sls.com', false)).toMatchObject({ to: ['amy@wfs.com'], cc: [], subject: 'Re: Order 55', thread_id: 't1', reply_to_email_id: 'e1', vendor_id: 'v1' })
    expect(replyDraft(t, incoming, 'orders@sls.com', true).cc).toEqual(['bob@wfs.com', 'dana@sls.com'])
    expect(replyDraft(t, incoming, 'orders@sls.com', false).body).toContain('> Shipped today.')
  })
  it('forwards outside the thread with the original underneath, and follows up to the same people', () => {
    const f = forwardDraft(t, incoming, 2)
    expect(f).toMatchObject({ to: [], subject: 'Fwd: Order 55', forward_email_id: 'e1' })
    expect(f.note).toContain('2 attachments')
    const out = { ...incoming, id: 'e2', direction: 'out' as const, from_email: 'orders@sls.com', to_emails: ['amy@wfs.com'], cc_emails: [] }
    expect(followUpDraft(t, out)).toMatchObject({ to: ['amy@wfs.com'], reply_to_email_id: 'e2', thread_id: 't1' })
  })
})
