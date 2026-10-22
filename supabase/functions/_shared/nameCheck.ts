// Another name re-checks the old (Dana, Oct 21): "when I go into a vendor and add an alias, it should go recheck anything
// that has a review flag to see if it can match it up." A vendor's name or alias added (or removed) is queued
// (vendor_name_checks); here the old mail is read again with the same rule new mail uses (mentionedVendors), so mail that
// names the vendor by its new name now does (and is tagged when it is a rep's or a service's), mail that named it only by
// a removed name no longer does, and the "Who is this?" and rep line cards follow. The counts show on the vendor page.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { buildVendorIndex, domainVendors, mentionedVendors, normalize } from './mailMatch.ts'
import { clueText, type ParsedAttachment } from './mailParse.ts'

interface CheckRow { check_id: string; vendor_id: string; vendor_name: string; aliases: string[] | null; added: string[] | null; removed: string[] | null }
export interface EmailRow { id: string; subject: string | null; body_text: string | null; from_name: string | null; files: string[] | null }

const PAGE = 300

async function ok(p: PromiseLike<{ error: { message: string } | null }>) {
  const { error } = await p
  if (error) throw new Error(error.message)
}

const clue = (e: EmailRow) => clueText({
  subject: e.subject,
  attachments: (e.files ?? []).map((f) => ({ file_name: f }) as ParsedAttachment),
  from: { email: '', name: e.from_name },
  body_text: e.body_text ?? '',
})

/** Runs waiting re-checks until the deadline (ms since epoch). A check cut short is picked up again 5 minutes later. */
export async function runNameChecks(db: SupabaseClient, org: string, deadline: number): Promise<number> {
  const { data: o } = await db.from('organizations').select('name').eq('id', org).single()
  const ours = ['Shaver Lake', (o?.name as string | undefined) ?? ''].filter(Boolean)
  let done = 0
  while (Date.now() < deadline) {
    const { data, error } = await db.rpc('vendor_name_check_next', { p_org: org })
    if (error) throw new Error(error.message)
    const c = (data as CheckRow[] | null)?.[0]
    if (!c) break
    try {
      if (await runOne(db, org, c, ours, deadline)) done++
    } catch (e) {
      await ok(db.rpc('vendor_name_check_fail', { p_check: c.check_id, p_note: e instanceof Error ? e.message : String(e) }))
    }
  }
  return done
}

/**
 * The vendor as it is now (every name it goes by, its PO numbers), and the phrases to look for: added names still on
 * the vendor, removed names no other name of it covers. Names are cleaned the way mail matching reads them
 * ("SUNNY PALS - WWD" → "sunny pals"); a word too common to be a clue gives no phrase.
 */
export function namesToCheck(c: Pick<CheckRow, 'vendor_id' | 'vendor_name' | 'aliases' | 'added' | 'removed'>, ours: string[], pos: { po_number: string | null; vendor_id: string }[] = []) {
  const full = buildVendorIndex([{ id: c.vendor_id, name: c.vendor_name, aliases: c.aliases ?? [] }], ours, pos)
  const phrasesOf = (names: string[]) => names.length ? [...buildVendorIndex([{ id: c.vendor_id, name: names[0]!, aliases: names.slice(1) }], ours).phrases.keys()] : []
  return { full, added: phrasesOf(c.added ?? []).filter((p) => full.phrases.has(p)), removed: phrasesOf(c.removed ?? []).filter((p) => !full.phrases.has(p)) }
}

/** Does this email (subject, file names, From name, body above the signature) name the vendor? */
export const namesVendor = (index: ReturnType<typeof buildVendorIndex>, vendorId: string, e: EmailRow) => mentionedVendors(index, clue(e)).includes(vendorId)

async function runOne(db: SupabaseClient, org: string, c: CheckRow, ours: string[], deadline: number): Promise<boolean> {
  const { data: pos } = await db.from('orders').select('po_number, vendor_id').eq('vendor_id', c.vendor_id).not('po_number', 'is', null).limit(2000)
  const { full, added, removed } = namesToCheck(c, ours, (pos ?? []) as { po_number: string | null; vendor_id: string }[])

  for (const [phrase, named] of [...added.map((p) => [p, false] as const), ...removed.map((p) => [p, true] as const)]) {
    let after: string | null = null
    for (;;) {
      if (Date.now() > deadline) return false
      const { data, error } = await db.rpc('vendor_name_check_emails', { p_org: org, p_vendor: c.vendor_id, p_phrase: phrase, p_named: named, p_after: after, p_limit: PAGE })
      if (error) throw new Error(error.message)
      const rows = (data ?? []) as EmailRow[]
      if (!rows.length) break
      const hits = rows.filter((e) => namesVendor(full, c.vendor_id, e) !== named).map((e) => e.id)
      if (hits.length) await ok(db.rpc('vendor_name_check_apply', { p_check: c.check_id, p_add: named ? [] : hits, p_remove: named ? hits : [] }))
      after = rows[rows.length - 1]!.id
      if (rows.length < PAGE) break
    }
  }

  // "Who is this?" senders whose web address is the new name (toyology.com and a vendor now called Toyology)
  const domainSenders: string[] = []
  if ((c.added ?? []).length) {
    const addedIndex = buildVendorIndex([{ id: c.vendor_id, name: c.added![0]!, aliases: c.added!.slice(1) }], ours)
    const { data: senders } = await db.from('email_senders').select('id, sender_key').eq('organization_id', org).eq('kind', 'unknown').eq('is_domain', true).limit(5000)
    for (const s of (senders ?? []) as { id: string; sender_key: string }[]) {
      if (domainVendors(addedIndex, s.sender_key).includes(c.vendor_id)) domainSenders.push(s.id)
    }
  }
  const words = [...new Set([...added, ...(c.added ?? []).map((n) => normalize(n).join(' '))])]
  const note = (c.added ?? []).length && !added.length && !(c.removed ?? []).length ? 'The new name is too common a word to look for in mail.' : null
  await ok(db.rpc('vendor_name_check_finish', { p_check: c.check_id, p_phrases: words, p_domain_senders: domainSenders, p_note: note }))
  return true
}
