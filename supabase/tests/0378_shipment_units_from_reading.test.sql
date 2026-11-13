-- 0378: a WWD invoice with no lines and no date yet takes the units and date of Claude's reading of the vendor's own
-- invoice with the same number, and links to that paper.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v uuid; o uuid; d uuid; inv uuid; t record;
begin
  insert into public.vendors (organization_id, name, ships_in_parts) values (v_org, 'WFS 0378', true) returning id into v;
  insert into public.orders (organization_id, vendor_id, status, po_number, source, order_date, est_cost) values (v_org, v, 'awaiting_confirmation', 'WFS0378', 'placed_order_summary', '2026-02-04', 1000) returning id into o;
  insert into public.vendor_links (organization_id, vendor_id, order_id, kind, label, storage_path, doc_number) values (v_org, v, o, 'confirmation', 'SO 0378', 'x/0378.pdf', 'S0378') returning id into d;
  update public.order_checks set status = 'done', reading = '{"lines":[{"vendor_item_id":"F-1","quantity":12},{"vendor_item_id":"F-2","quantity":24}]}'::jsonb where document_id = d;
  -- the vendor's invoice -2, read by Claude, filed on the order; Worldwide's row for it has no lines and no date yet
  insert into public.vendor_links (organization_id, vendor_id, order_id, kind, label, storage_path, doc_number, doc_date) values (v_org, v, o, 'invoice', 'Invoice I90378-2', 'x/0378-2.pdf', 'I90378-2', '2026-10-30') returning id into inv;
  update public.order_checks set status = 'to_review', reading = '{"lines":[{"vendor_item_id":"F-2","quantity":24}]}'::jsonb where document_id = inv;
  insert into public.wwd_invoices (organization_id, seq, kind, wwd_vendor_name, vendor_id, po_number, vendor_invoice_number, amount, order_id) values (v_org, '9000378', 'invoice', 'World Famous Sports', v, 'WFS0378-2', 'I903782', 500, o);
  perform public.order_shipments_sync(o);
  select * into t from public.order_shipments where order_id = o;
  if t.units <> 24 or t.shipped_on <> '2026-10-30' or t.vendor_link_id <> inv then raise exception 'shipment did not take the reading: % % %', t.units, t.shipped_on, t.vendor_link_id; end if;
  select * into t from public.orders where id = o;
  if t.status <> 'shipped' then raise exception 'F-1 is still to come, should be Shipped in part: %', t.status; end if;
  raise exception 'ok-rollback';
exception when others then
  if sqlerrm <> 'ok-rollback' then raise; end if;
end $$;
