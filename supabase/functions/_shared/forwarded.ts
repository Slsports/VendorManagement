// Forwarded mail (Dana, Oct 15): vendors still write to the old Gmail, billing@ or someone's own address, and the email is
// forwarded to orders@. The vendor is the forwarded message's sender, read from its "From:" line. Pure, so it can be tested.

export interface Forwarded { email: string | null; name: string | null }

const FWD_SUBJECT = /^\s*((re|aw)\s*:\s*)*(fwd?|fw)\s*:/i
const FWD_MARK = /-{3,}\s*Forwarded message|Begin forwarded message:|-{3,}\s*Original Message\s*-{3,}/i
const EMAIL = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

/** A forwarded email: the subject says Fwd/FW, or the body carries a forwarded-message header. */
export function isForward(subject: string | null, body: string | null): boolean {
  return FWD_SUBJECT.test(subject ?? '') || FWD_MARK.test(body ?? '')
}

/**
 * The first sender in the forwarded part who is not one of us (a forward of a forward skips our own From lines).
 * "Kelly Lee (kelly@okumafishingusa.com) <system@sent-via.netsuite.com>": the address in brackets is the person, the
 * other is the billing system's relay. Null when the email is not a forward; {email: null} when it is but no outside
 * sender is named.
 */
export function forwardedSender(subject: string | null, body: string | null, isOurs: (email: string) => boolean): Forwarded | null {
  if (!isForward(subject, body)) return null
  const text = (body ?? '').replace(/\r/g, '')
  const mark = text.search(FWD_MARK)
  const lines = (mark >= 0 ? text.slice(mark) : text).split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*[*>\s]*From:\*?\s*(.*)$/i.exec(lines[i]!)
    if (!m) continue
    // a long From line wraps: "… <" on one line, the address on the next
    const line = /@/.test(m[1]!) && !/<\s*$/.test(m[1]!) ? m[1]! : `${m[1]!} ${lines[i + 1] ?? ''}`
    const inBrackets = /\(([^()\s]+@[^()\s]+)\)/.exec(line)?.[1]
    const all = [...new Set([inBrackets, ...(line.match(EMAIL) ?? [])].filter((x): x is string => !!x).map((x) => x.toLowerCase().replace(/^mailto:/, '')))]
    const outside = all.find((e) => !isOurs(e))
    if (!outside) continue
    const name = line.split(/[<([]/)[0]!.replace(/["*]/g, '').trim() || null
    return { email: outside, name: name && !name.includes('@') ? name : null }
  }
  return { email: null, name: null }
}
