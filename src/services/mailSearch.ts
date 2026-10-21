import { supabase } from '@/lib/supabase'
import { toSearchArgs, type MailFilters } from '@/lib/mailSearch'
import { listThreads, ORDERS, type ThreadRow } from '@/services/mail'
import type { Json } from '@/types/database'

export interface MailMatch { email_id: string; why: string | null; headline: string | null }

/**
 * Search the mail (Dana, Oct 21): the conversations that match, newest first, each with the email that matched (to open
 * it directly), why it matched and the matching words. `scope`: the mailbox (Orders by default), a vendor page's vendor,
 * or the Sent tab.
 */
export async function searchMail(organizationId: string, f: MailFilters, scope: { box?: string; vendorId?: string; dir?: 'in' | 'out' } = {}): Promise<{ rows: ThreadRow[]; matches: Map<string, MailMatch> }> {
  const box = scope.box ?? ORDERS
  const { p_q, p } = toSearchArgs(f, { ...scope, box })
  const { data, error } = await supabase.rpc('mail_search', { p_q, p: p as unknown as Json })
  if (error) throw error
  const hits = data ?? []
  const matches = new Map(hits.map((h) => [h.thread_id, { email_id: h.email_id, why: h.why, headline: h.headline }]))
  if (!hits.length) return { rows: [], matches }
  const rows = await listThreads(organizationId, undefined, { view: 'all', who: 'all', status: 'all', onlyIds: hits.map((h) => h.thread_id), mailbox: box === 'all' ? undefined : box }, hits.length)
  const order = new Map(hits.map((h, i) => [h.thread_id, i]))
  return { rows: rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)), matches }
}

export type MailSuggestion = { kind: 'person' | 'vendor' | 'rep_group' | 'order'; id: string; label: string; sub: string | null; address: string | null }

/** As you type: people with their address, vendors, rep groups, POs. */
export async function suggestMail(q: string): Promise<MailSuggestion[]> {
  if (q.trim().length < 2) return []
  const { data, error } = await supabase.rpc('mail_suggest', { p_q: q.trim() })
  if (error) throw error
  // one line per address
  const seen = new Set<string>()
  return (data ?? []).filter((s) => { const k = s.kind === 'person' ? `p:${s.address}` : `${s.kind}:${s.id}`; if (seen.has(k)) return false; seen.add(k); return true })
}
