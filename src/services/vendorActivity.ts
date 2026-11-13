import { supabase } from '@/lib/supabase'
import { buildFeed, type FeedDoc, type FeedItem, type FeedOrder, type FeedStatus, type FeedTask, type FeedNote } from '@/lib/vendorActivity'

/** Everything done with a vendor, newest first (Dana, Nov 3): emails, papers, orders, tasks and notes. */
export async function vendorActivityFeed(organizationId: string, vendorId: string, limit: number): Promise<FeedItem[]> {
  const [emails, docs, orders, tasks, notes, people] = await Promise.all([
    supabase.rpc('vendor_recent_activity', { p_vendor: vendorId, p_limit: Math.min(limit, 50) }),
    supabase.from('vendor_links').select('id, kind, label, file_name, doc_number, doc_date, doc_total, received_at, created_at, source, storage_path, mime_type, order:orders!vendor_links_order_id_fkey(po_number)')
      .eq('vendor_id', vendorId).not('kind', 'in', '(image,website)').order('created_at', { ascending: false }).limit(limit * 4),
    supabase.from('orders').select('id, po_number, order_date, placed_by, date_received, date_entered_ls, entered_by, paid_date, status')
      .or(`vendor_id.eq.${vendorId},brand_vendor_id.eq.${vendorId}`).order('order_date', { ascending: false, nullsFirst: false }).limit(limit),
    supabase.from('tasks').select('id, title, done_at, done_note, closed_how, done_by')
      .eq('vendor_id', vendorId).not('done_at', 'is', null).neq('closed_how', 'mistake').order('done_at', { ascending: false }).limit(limit),
    supabase.from('notes').select('id, body, created_at, created_by').eq('entity_type', 'vendor').eq('entity_id', vendorId).order('created_at', { ascending: false }).limit(limit),
    supabase.from('profiles').select('id, full_name, email').eq('organization_id', organizationId),
  ])
  for (const r of [emails, docs, orders, tasks, notes, people]) if (r.error) throw r.error
  const name = new Map((people.data ?? []).map((p) => [p.id, p.full_name || p.email || null]))
  const orderRows = (orders.data ?? []) as FeedOrder[]
  const statuses = orderRows.length
    ? await supabase.from('order_status_history').select('id, order_id, from_status, to_status, changed_at, changed_by')
      .in('order_id', orderRows.map((o) => o.id)).in('to_status', ['awaiting_confirmation', 'confirmed', 'shipped', 'cancelled'])
      .order('changed_at', { ascending: false }).limit(limit)
    : { data: [], error: null }
  if (statuses.error) throw statuses.error
  const po = new Map(orderRows.map((o) => [o.id, o.po_number]))
  return buildFeed({
    emails: emails.data ?? [],
    docs: (docs.data ?? []).map((d) => ({ ...d, po_number: (d.order as { po_number: string | null } | null)?.po_number ?? null }) as FeedDoc),
    orders: orderRows,
    statuses: (statuses.data ?? []).map((s) => ({ id: s.id, order_id: s.order_id, po_number: po.get(s.order_id) ?? null, from_status: s.from_status, to_status: s.to_status, changed_at: s.changed_at, who: s.changed_by ? name.get(s.changed_by) ?? null : null }) as FeedStatus),
    tasks: (tasks.data ?? []).map((t) => ({ id: t.id, title: t.title, done_at: t.done_at!, done_note: t.done_note, closed_how: t.closed_how, who: t.done_by ? name.get(t.done_by) ?? null : null }) as FeedTask),
    notes: (notes.data ?? []).map((n) => ({ id: n.id, body: n.body, created_at: n.created_at, who: n.created_by ? name.get(n.created_by) ?? null : null }) as FeedNote),
  }, limit)
}
