// Read every stored email's vendor clues again with the current rules (supabase/functions/_shared/mailMatch.ts)
// and file what can be filed now: after a rule change (Oct 8: PO numbers decide, first-name lines need another
// clue, "Worldwide" alone never decides). Mail already filed stays filed; views are left as they are.
//   NODE_USE_ENV_PROXY=1 node scripts/rematch-mail.mjs [--dry]
import { query, lit } from './db.mjs'
import { buildVendorIndex, mentionedVendors } from '../supabase/functions/_shared/mailMatch.ts'
import { bodyAboveSignature } from '../supabase/functions/_shared/mailParse.ts'

const dry = process.argv.includes('--dry')
const orgs = await query(`select distinct organization_id as id from public.emails`)
for (const { id: org } of orgs) {
  const vendors = await query(`select id, name, aliases from public.vendors where organization_id = ${lit(org)} and is_active`)
  const orders = await query(`select po_number, vendor_id from public.orders where organization_id = ${lit(org)} and po_number is not null`)
  const [o] = await query(`select name from public.organizations where id = ${lit(org)}`)
  const index = buildVendorIndex(vendors, ['Shaver Lake', o?.name ?? ''].filter(Boolean), orders)

  let changed = 0, seen = 0
  const touched = []
  for (let after = '00000000-0000-0000-0000-000000000000'; ;) {
    const rows = await query(`
      select e.id, e.subject, e.from_name, e.body_text, e.mentioned_vendor_ids,
             (select string_agg(a.file_name, ' \n ') from public.email_attachments a where a.email_id = e.id) as files
        from public.emails e
       where e.organization_id = ${lit(org)} and e.id > ${lit(after)}
       order by e.id limit 400`)
    if (!rows.length) break
    after = rows[rows.length - 1].id
    const updates = []
    for (const r of rows) {
      seen++
      const files = (r.files ?? '').replace(/\.[a-z0-9]{2,5}(?=\s|$)/gi, '').replace(/[_.]+/g, ' ')
      const subject = (r.subject ?? '').replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '')
      const now = mentionedVendors(index, { strong: [subject, files].join(' \n '), body: bodyAboveSignature(r.body_text), from: r.from_name ?? '' }).sort()
      const before = [...(r.mentioned_vendor_ids ?? [])].sort()
      if (now.join(',') !== before.join(',')) updates.push([r.id, now])
    }
    if (updates.length && !dry) {
      await query(`update public.emails e set mentioned_vendor_ids = u.ids
                     from (values ${updates.map(([id, ids]) => `(${lit(id)}::uuid, ${lit(`{${ids.join(',')}}`)}::uuid[])`).join(',')}) as u(id, ids)
                    where e.id = u.id`)
    }
    changed += updates.length
    touched.push(...updates.map(([id]) => id))
  }
  console.log(`${seen} emails read, ${changed} with different vendor clues${dry ? ' (dry run, nothing written)' : ''}`)
  if (dry || !touched.length) continue
  let linked = 0
  for (let i = 0; i < touched.length; i += 200) {
    const [r] = await query(`select public.mail_rematch(${lit(org)}, ${lit(`{${touched.slice(i, i + 200).join(',')}}`)}::uuid[]) as n`)
    linked += r.n
  }
  console.log(`${linked} emails filed to a vendor now; "Who is this mail from?" proposals refreshed`)
}
