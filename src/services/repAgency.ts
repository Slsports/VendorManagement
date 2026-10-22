import { supabase } from '@/lib/supabase'
import type { Json, VendorNameCheck } from '@/types'

/** A vendor a sender's mail names, and in how many emails (the "Who is this?" card lists them all, Dana Oct 21). */
export interface NamedVendor { id: string; name: string; n: number; rep_group: string | null }
/** A person at a rep agency: from Claude's reading of the signatures, or the From line of their mail. */
export interface RepPerson { name: string; email: string | null; phone: string | null; title: string | null }

/** The people who wrote from a sender (name and address from the From line), most mail first. */
export async function senderPeople(senderId: string): Promise<RepPerson[]> {
  const { data, error } = await supabase.from('emails').select('from_name, from_email').eq('sender_id', senderId).eq('direction', 'in').order('received_at', { ascending: false }).limit(300)
  if (error) throw error
  const byEmail = new Map<string, RepPerson & { n: number }>()
  for (const e of data ?? []) {
    const email = (e.from_email ?? '').toLowerCase().trim()
    if (!email) continue
    const was = byEmail.get(email)
    if (was) { was.n++; if (!was.name && e.from_name) was.name = e.from_name; continue }
    byEmail.set(email, { name: e.from_name ?? '', email, phone: null, title: null, n: 1 })
  }
  return [...byEmail.values()].sort((a, b) => b.n - a.n).map(({ n: _n, ...p }) => p)
}

/** Claude's people first (they carry phone and title), then anyone else who wrote; one per address. */
export function mergePeople(fromClaude: RepPerson[], fromMail: RepPerson[]): RepPerson[] {
  const out: RepPerson[] = []
  const seen = new Set<string>()
  for (const p of [...fromClaude, ...fromMail]) {
    const key = (p.email ?? '').toLowerCase().trim() || `name:${p.name.toLowerCase().trim()}`
    if (key === 'name:' || seen.has(key)) continue
    seen.add(key)
    out.push({ name: p.name.trim(), email: p.email?.toLowerCase().trim() || null, phone: p.phone || null, title: p.title || null })
  }
  return out
}

export interface RepGroupFromSenderResult { rep_group_id: string; created: boolean; people: number; linked: number; lines_added: string[]; asked: number; tagged: number }

/** New rep group from a "Who is this?" card: the group, its people, its lines, the sender filed, every email tagged. */
export async function repGroupFromSender(senderId: string, name: string, website: string, phone: string, people: RepPerson[], vendorIds: string[]): Promise<RepGroupFromSenderResult> {
  const { data, error } = await supabase.rpc('rep_group_from_sender', {
    p_sender: senderId, p_name: name, p_website: website || null, p_phone: phone || null, p_contacts: people as unknown as Json, p_vendors: vendorIds,
  })
  if (error) throw error
  return data as unknown as RepGroupFromSenderResult
}

/** "Does this name belong on this vendor?" Remove it, or keep it. */
export async function answerVendorAlias(itemId: string, remove: boolean): Promise<void> {
  const { error } = await supabase.rpc('vendor_alias_answer', { p_item: itemId, p_remove: remove })
  if (error) throw error
}

/** The newest re-check of a vendor's old mail and review cards after a name was added or removed, in the last two weeks. */
export async function latestNameCheck(vendorId: string): Promise<VendorNameCheck | null> {
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString()
  const { data, error } = await supabase.from('vendor_name_checks').select('*').eq('vendor_id', vendorId).gte('created_at', since).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  return data
}
