import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { fillSignature, htmlEmail, textEmail } from './signature'

const TEMPLATE = '{name}\n{title}\nShaver Lake Sports\nStore: 559-841-2740{direct}\norders@shaverlakesports.com | shaverlakesports.com'

describe('signatures', () => {
  it('fills the template, leaving out an empty title and direct line', () => {
    expect(fillSignature(TEMPLATE, { name: 'Dana Powell', title: 'Manager', direct: '559-406-7299', own: null }))
      .toBe('Dana Powell\nManager\nShaver Lake Sports\nStore: 559-841-2740 | Direct: 559-406-7299\norders@shaverlakesports.com | shaverlakesports.com')
    expect(fillSignature(TEMPLATE, { name: 'Trevor Jenkins', title: null, direct: null, own: null }).split('\n')[1]).toBe('Shaver Lake Sports')
  })
  it('uses a person\'s own version when they keep one', () => {
    expect(fillSignature(TEMPLATE, { name: 'Dana', title: null, direct: null, own: 'Dana\nSLS' })).toBe('Dana\nSLS')
  })
  it('puts the signature above the quoted mail of a reply', () => {
    const body = 'Thanks!\n\nOn Oct 5, 2026, Jessica wrote:\n> Hi'
    expect(textEmail(body, 'Dana')).toBe('Thanks!\n\nDana\n\nOn Oct 5, 2026, Jessica wrote:\n> Hi\n')
    const html = htmlEmail(body, 'Dana\norders@shaverlakesports.com')
    expect(html.indexOf('email-logo.png')).toBeLessThan(html.indexOf('wrote:'))
    expect(html).toContain('mailto:orders@shaverlakesports.com')
  })
  it('matches the sending side', () => {
    const app = readFileSync(resolve(process.cwd(), 'src/lib/signature.ts'), 'utf8').split('\n').slice(2).join('\n')
    const fn = readFileSync(resolve(process.cwd(), 'supabase/functions/_shared/signature.ts'), 'utf8').split('\n').slice(2).join('\n')
    expect(app).toBe(fn)
  })
})
