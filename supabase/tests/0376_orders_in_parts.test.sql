-- 0376: a vendor who ships in parts: the confirmation's lines against each invoice; Shipped in part until all is in, then
-- Received as of the last shipment; every date the paper's.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v uuid; o uuid; w1 uuid; w2 uuid; d uuid; r jsonb; t record; n integer;
begin
  insert into public.vendors (organization_id, name, ships_in_parts) values (v_org, 'WFS 0373', true) returning id into v;
  insert into public.orders (organization_id, vendor_id, status, po_number, source, order_date, est_cost) values (v_org, v, 'awaiting_confirmation', 'WFS0373', 'placed_order_summary', '2026-02-04', 1000) returning id into o;
  -- the confirmation Claude read: three items
  insert into public.vendor_links (organization_id, vendor_id, order_id, kind, label, storage_path, doc_number) values (v_org, v, o, 'confirmation', 'SO 0373', 'x/0373.pdf', 'S0373') returning id into d;
  -- filing the confirmation made its check; Claude's reading of it: three items
  update public.order_checks set status = 'done', reading = '{"lines":[{"vendor_item_id":"F-1","quantity":12},{"vendor_item_id":"F-2","quantity":24},{"vendor_item_id":"F-3","quantity":6}]}'::jsonb where document_id = d;
  -- shipment 1 billed by Worldwide: F-1 in full, half of F-2
  insert into public.wwd_invoices (organization_id, seq, kind, wwd_vendor_name, vendor_id, po_number, vendor_invoice_number, wwd_date, amount, order_id) values (v_org, '9000373', 'invoice', 'World Famous Sports', v, 'WFS0373', 'I90373', '2026-08-24', 400, o) returning id into w1;
  insert into public.wwd_invoice_lines (organization_id, invoice_id, line_no, vendor_item_id, description, quantity, unit_price, amount) values (v_org, w1, 1, 'F-1', 'Jacket', 12, 20, 240), (v_org, w1, 2, 'F-2', 'Pant', 12, 10, 120);
  r := public.orders_closeout(v_org);
  select * into t from public.orders where id = o;
  if t.status <> 'shipped' or t.date_received is not null then raise exception 'first shipment should leave it Shipped in part: % %', t.status, r; end if;
  if (select count(*) from public.order_shipments where order_id = o) <> 1 then raise exception 'no shipment row'; end if;
  select count(*) into n from public.order_tally(o) where still > 0; if n <> 2 then raise exception 'tally: expected 2 items still to come, got %', n; end if;
  if (select (changed_at at time zone 'America/Los_Angeles')::date from public.order_status_history where order_id = o and to_status = 'shipped') <> '2026-08-24' then raise exception 'shipped history not dated by the invoice'; end if;
  -- shipment 2 (-2): the rest
  insert into public.wwd_invoices (organization_id, seq, kind, wwd_vendor_name, vendor_id, po_number, vendor_invoice_number, wwd_date, amount) values (v_org, '9000374', 'invoice', 'World Famous Sports', v, 'WFS0373-2', 'I90373-2', '2026-09-25', 300) returning id into w2;
  insert into public.wwd_invoice_lines (organization_id, invoice_id, line_no, vendor_item_id, description, quantity, unit_price, amount) values (v_org, w2, 1, 'F-2', 'Pant', 12, 10, 120), (v_org, w2, 2, 'F-3', 'Bag', 6, 30, 180);
  r := public.orders_closeout(v_org);
  if (select order_id from public.wwd_invoices where id = w2) <> o then raise exception 'the -2 invoice did not tie to the order'; end if;
  select * into t from public.orders where id = o;
  if t.status <> 'received' or t.date_received <> '2026-09-25' then raise exception 'all in should make it Received as of the last shipment: % %', t.status, t.date_received; end if;
  if (select count(*) from public.order_shipments where order_id = o) <> 2 then raise exception 'two shipments expected'; end if;
  if (select received_so_far from public.order_shipments where order_id = o and seq = 2) <> 42 then raise exception 'running count wrong'; end if;
  if (select (changed_at at time zone 'America/Los_Angeles')::date from public.order_status_history where order_id = o and to_status = 'received') <> '2026-09-25' then raise exception 'received history not dated by the last invoice'; end if;
  raise exception 'ok-rollback';
exception when others then
  if sqlerrm <> 'ok-rollback' then raise; end if;
end $$;
