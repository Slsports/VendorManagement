import { supabase } from '@/lib/supabase'
import type { RoutingLetter, RoutingLetterSend } from '@/types'
import type { Json } from '@/types/database'
import { checkUploadSize, readForUpload, uploadError } from '@/lib/upload'
import { buildRoutingLetterPdf, routingLetterFileName, type RoutingLetterContent } from '@/lib/routingLetterPdf'

// The freight routing letter (Dana, Oct 13): versions, who it went to, and who confirmed receiving it.

export type RoutingWho = 'open_orders' | 'previous' | 'all'
export type RoutingSendRow = RoutingLetterSend & { vendor: { id: string; name: string } | null; letter: { version: number } | null }

export const DEFAULT_ROUTING_EMAIL = `Hello {first_name},

Over the past year, freight on some of our orders has run 70% to 120% of the merchandise cost: boxes that were too large for what was in them, orders split across many small cartons, and carrier charges we never approved. Shaver Lake is a remote mountain delivery area, so every extra carton adds up fast. We can't keep absorbing those costs, so we have updated our routing instructions. They are attached; please share them with your shipping department.

In short: if the freight on an order is 10% or less of the merchandise cost, go ahead and ship it and add the freight to the invoice. If it is over 10%, please send us your freight quote and the shipment details first, and we will schedule the shipment. And please pack our orders in the fewest, fullest boxes possible.

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
  checkUploadSize(file)
  const { error: upErr } = await supabase.storage.from('vendor-files').upload(path, await readForUpload(file), { contentType: file.type || 'application/pdf', upsert: false }).catch((e: unknown) => ({ error: e }))
  if (upErr) throw uploadError(upErr, file)
  const { data, error } = await supabase.rpc('routing_letter_add', { p_org: organizationId, p_path: path, p_file_name: file.name, p_effective: f.effective, p_note: f.note, p_subject: f.subject, p_body: f.body })
  if (error) throw error
  return data as string
}

/**
 * Save the letter written in VMS as a new version (Dana, Nov 12): VMS draws the PDF from the words, files it like an
 * uploaded one, and keeps the words on the version so the next edit starts from them.
 */
export async function saveWrittenLetter(organizationId: string, version: number, content: RoutingLetterContent, f: { effective: string | null; note: string; subject: string; body: string }): Promise<string> {
  const file = new File([await routingLetterPdfBlob(content)], routingLetterFileName(version), { type: 'application/pdf' })
  const id = await addRoutingLetter(organizationId, file, f)
  const { error } = await supabase.from('routing_letters').update({ content: content as unknown as Json }).eq('id', id)
  if (error) throw error
  return id
}

/** The letter as a PDF, drawn from its words with the store's logo. */
export async function routingLetterPdfBlob(content: RoutingLetterContent): Promise<Blob> {
  const logo = await fetch('/brand/sls/email-logo@2x.png').then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null)
  const bytes = await buildRoutingLetterPdf(content, logo ? new Uint8Array(logo) : null)
  return new Blob([bytes as BlobPart], { type: 'application/pdf' })
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
