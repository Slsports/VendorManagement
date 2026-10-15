import { describe, expect, it } from 'vitest'
import { forwardedSender, isForward } from './forwarded'

const ours = (e: string) => /@shaverlakesports\.com$/.test(e) || ['shaverlakesports@gmail.com', 'billing.slsports@gmail.com'].includes(e)

describe('forwarded vendor mail (Oct 15)', () => {
  it('finds the rep who wrote to the old Gmail (Panther Martin)', () => {
    const body = '---------- Forwarded message ---------\nFrom: Bruce MacDonald <lifetimebruce1@gmail.com>\nDate: Tue, Sep 1, 2026 at 11:09 AM\nSubject: Panther Martin Order\nTo: <shaverlakesports@gmail.com>\n\nHi Jarrett,'
    expect(forwardedSender('Fwd: Panther Martin Order', body, ours)).toEqual({ email: 'lifetimebruce1@gmail.com', name: 'Bruce MacDonald' })
  })
  it('uses the person in brackets, not the billing system relay, even when the line wraps (Okuma via NetSuite)', () => {
    const body = '---------- Forwarded message ---------\nFrom: Okuma Fishing Tackle USA (do_not_reply@okumafishingusa.com) <\nsystem@sent-via.netsuite.com>\nDate: Thu, Sep 3, 2026'
    expect(forwardedSender('Fwd: Your order no. SO498604 has been approved!', body, ours)?.email).toBe('do_not_reply@okumafishingusa.com')
  })
  it('skips our own From lines in a forward of a forward (Brentwood)', () => {
    const body = '---------- Forwarded message ---------\nFrom: Shaver Lake Sports <shaverlakesports@gmail.com<mailto:shaverlakesports@gmail.com>>\nTo: Jane Grace <jane@shaverlakesports.com>\n\nHi!\n\n---------- Forwarded message ---------\nFrom: Jeevan Kamnani <jeevan@brentwoodus.com<mailto:jeevan@brentwoodus.com>>\nSubject: Show order update'
    expect(forwardedSender('Fwd: Brentwoid appliance -Show order update', body, ours)).toEqual({ email: 'jeevan@brentwoodus.com', name: 'Jeevan Kamnani' })
  })
  it('reads Outlook forwards', () => {
    const body = 'FYI\n\n-----Original Message-----\nFrom: Sales <sales@stansport.com>\nSent: Monday, May 4, 2026 9:12 AM\nTo: Billing <billing.slsports@gmail.com>'
    expect(forwardedSender('FW: Invoice 1234', body, ours)?.email).toBe('sales@stansport.com')
  })
  it('is not a forward, or names no outside sender', () => {
    expect(forwardedSender('Re: order', 'On Tue, Sep 1 Bruce wrote:\n> hi', ours)).toBeNull()
    expect(isForward('Fwd: note', '')).toBe(true)
    expect(forwardedSender('Fwd: note', 'see below', ours)).toEqual({ email: null, name: null })
  })
})
