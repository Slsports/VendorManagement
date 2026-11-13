import { supabase } from '@/lib/supabase'
import type { MessageTemplate } from '@/types'

// What VMS writes to vendors, in one place to read and edit (Dana, Nov 13: "anytime we have an email draft or letter that
// sends to vendors I want them in one place where I can edit any time I want").

export async function listTemplates(organizationId: string): Promise<MessageTemplate[]> {
  const { data, error } = await supabase.from('message_templates').select('*').eq('organization_id', organizationId).order('category').order('title')
  if (error) throw error
  return data ?? []
}

export async function saveTemplate(organizationId: string, key: string, subject: string, body: string): Promise<void> {
  const { error } = await supabase.from('message_templates').update({ subject, body }).eq('organization_id', organizationId).eq('key', key)
  if (error) throw error
}

/** The order's Freight email draft (made now when there is none): one click from anywhere (Dana, Nov 13). */
export async function openFreightEmail(orderId: string): Promise<string> {
  const { data, error } = await supabase.rpc('freight_email_open', { p_order: orderId })
  if (error) throw error
  return data as string
}

/** A vendor's orders still to ship (Sent, Placed, Confirmed, Shipped) and when their freight email went. */
export async function listOpenOrdersForFreight(vendorId: string) {
  const { data, error } = await supabase.from('orders').select('id, po_number, order_date, est_cost, status, ship_email_sent_at')
    .eq('vendor_id', vendorId).in('status', ['open', 'awaiting_confirmation', 'confirmed', 'shipped']).order('order_date', { ascending: false, nullsFirst: false }).limit(20)
  if (error) throw error
  return (data ?? []).map((o) => ({ ...o, sent: o.ship_email_sent_at as string | null }))
}
