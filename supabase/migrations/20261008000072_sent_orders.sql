-- 0093 — Orders we email to vendors become orders (Dana, Oct 12: Jarrett's Mack's Lure early-buy order was in Mail but
-- never an order, so its confirmation had nothing to compare with; "definitely scan the email too"). The sent-orders
-- function reads our sent Orders mail (12 months back, then as it arrives): Claude sorts which emails place an order,
-- reads the order from the email and its attachment (PDF, picture or spreadsheet), and VMS links it to the order on
-- file (same PO, or same vendor, date and total) or adds it as Placed. Old unmatched orders are only listed, not added.
-- Confirmations waiting for their order are matched again.
alter table public.emails add column if not exists order_scan jsonb;
alter table public.emails add column if not exists order_scanned_at timestamptz;
create index if not exists emails_sent_order_scan_idx on public.emails (organization_id, received_at desc)
  where direction = 'out' and order_scanned_at is null and mailbox_id is null and copy_of is null;

-- Confirmations and invoices still waiting for their order: try again (a new order just came in).
create or replace function public.order_checks_refind(p_org uuid, p_vendor uuid)
returns integer
language plpgsql security definer set search_path = public as $$
declare c record; v_order uuid; n integer := 0;
begin
  for c in select * from public.order_checks where organization_id = p_org and vendor_id = p_vendor and status = 'needs_order' loop
    v_order := public.order_check_find_order(p_org, p_vendor, c.kind, c.po_number, c.doc_total, c.doc_date);
    if v_order is not null then
      update public.order_checks set order_id = v_order, status = 'comparing', working_at = null,
        assigned_to = public.order_reviewer(v_order), assigned_at = now() where id = c.id;
      update public.vendor_links set order_id = v_order where id = c.document_id and order_id is null;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
revoke execute on function public.order_checks_refind(uuid, uuid) from public, anon, authenticated;
grant execute on function public.order_checks_refind(uuid, uuid) to service_role;
