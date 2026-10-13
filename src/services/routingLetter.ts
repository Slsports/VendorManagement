import { supabase } from '@/lib/supabase'
import type { RoutingLetter, RoutingLetterSend } from '@/types'

// The freight routing letter (Dana, Oct 13): versions, who it went to, and who confirmed receiving it.

export type RoutingWho = 'open_orders' | 'previous' | 'all'
export type RoutingSendRow = RoutingLetterSend & { vendor: { id: string; name: string } | null; letter: { version: number } | null }

export const DEFAULT_ROUTING_EMAIL = `Hello {first_name},

Over the past year, freight on some of our orders has run 70% to 120% of the merchandise cost: boxes that were too large for what was in them, orders split across many small cartons, and carrier charges we never approved. Shaver Lake is a remote mountain delivery area, so every extra carton adds up fast. We can't keep absorbing those costs, so we have tightened our shipping procedures.

Effective October 14, 2026, no order ships until we have approved a freight quote. Our routing instructions are attached. Please share them with your shipping department.

{open_orders}
Please click below to confirm you received them:
{receipt_link}

Thank you for working with us on this. Questions can go to orders@shaverlakesports.com.`

export async function listRoutingLetters(organizationId: string): Promise<RoutingLetter[]> {
  const { data, error } = await supabase.from('routing_letters').select('*').eq('organization_id', organizationId).order('version', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function addRoutingLetter(organizationId: string, file: File, f: { effective: string | null; note: string; subject: string; body: string }): Promise<string> {
  const path = `${organizationId}/routing/${crypto.randomUUID()}-${file.name.replace(/[^A-Za-z0-9._-]+/g, '_')}`
  const { error: upErr } = await supabase.storage.from('vendor-files').upload(path, file, { contentType: file.type || 'application/pdf', upsert: false })
  if (upErr) throw upErr
  const { data, error } = await supabase.rpc('routing_letter_add', { p_org: organizationId, p_path: path, p_file_name: file.name, p_effective: f.effective, p_note: f.note, p_subject: f.subject, p_body: f.body })
  if (error) throw error
  return data as string
}

export async function updateRoutingEmail(letterId: string, subject: string, body: string): Promise<void> {
  const { error } = await supabase.from('routing_letters').update({ email_subject: subject, email_body: body }).eq('id', letterId)
  if (error) throw error
}

/** Make the emails (Mail › Drafts, one per person). Returns how many. */
export async function prepareRoutingEmails(letterId: string, who: RoutingWho): Promise<number> {
  const { data, error } = await supabase.rpc('routing_letter_prepare', { p_letter: letterId, p_who: who })
  if (error) throw error
  return data as number
}

export async function listRoutingMissing(organizationId: string, who: 'open_orders' | 'all') {
  const { data, error } = await supabase.rpc('routing_letter_missing', { p_org: organizationId, p_who: who })
  if (error) throw error
  return data ?? []
}

const SEND_SELECT = '*, vendor:vendors!routing_letter_sends_vendor_id_fkey(id, name), letter:routing_letters!routing_letter_sends_letter_id_fkey(version)'

export async function listRoutingSends(organizationId: string, vendorId?: string): Promise<RoutingSendRow[]> {
  let q = supabase.from('routing_letter_sends').select(SEND_SELECT).eq('organization_id', organizationId)
  if (vendorId) q = q.eq('vendor_id', vendorId)
  const { data, error } = await q.order('created_at', { ascending: false }).limit(2000)
  if (error) throw error
  return (data ?? []) as unknown as RoutingSendRow[]
}

export async function routingLetterUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from('vendor-files').createSignedUrl(storagePath, 60 * 60)
  if (error) throw error
  return data.signedUrl
}
