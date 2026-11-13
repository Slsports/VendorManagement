-- 0377: a sized invoice line (F-125-1-S) counts against its confirmation item (F-125-1); an item billed under a key the
-- confirmation never had is still extra.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v uuid; o uuid; w1 uuid; d uuid; t record; n integer;
begin
  insert into public.vendors (organization_id, name, ships_in_parts) values (v_org, 'WFS 0377', true) returning id into v;
  insert into public.orders (organization_id, vendor_id, status, po_number, source, order_date, est_cost) values (v_org, v, 'awaiting_confirmation', 'WFS0377', 'placed_order_summary', '2026-02-04', 1000) returning id into o;
  insert into public.vendor_links (organization_id, vendor_id, order_id, kind, label, storage_path, doc_number) values (v_org, v, o, 'confirmation', 'SO 0377', 'x/0377.pdf', 'S0377') returning id into d;
  update public.order_checks set status = 'done', reading = '{"lines":[{"vendor_item_id":"F-125-1","quantity":36},{"vendor_item_id":"G-7","quantity":10}]}'::jsonb where document_id = d;
  insert into public.wwd_invoices (organization_id, seq, kind, wwd_vendor_name, vendor_id, po_number, vendor_invoice_number, wwd_date, amount, order_id) values (v_org, '9000377', 'invoice', 'World Famous Sports', v, 'WFS0377', 'I90377', '2026-08-24', 400, o) returning id into w1;
  insert into public.wwd_invoice_lines (organization_id, invoice_id, line_no, vendor_item_id, description, quantity, unit_price, amount)
  values (v_org, w1, 1, 'F-125-1-S', 'Jacket S', 12, 20, 240), (v_org, w1, 2, 'F-125-1-M', 'Jacket M', 12, 20, 240), (v_org, w1, 3, 'H-9-L', 'Hat', 3, 5, 15);
  select * into t from public.order_tally(o) where vendor_item_id = 'F-125-1';
  if t.received <> 24 or t.still <> 12 or not t.on_confirmation then raise exception 'sizes not counted against the confirmation item: % % %', t.received, t.still, t.on_confirmation; end if;
  select count(*) into n from public.order_tally(o) where not on_confirmation; if n <> 1 then raise exception 'expected one extra item, got %', n; end if;
  perform public.order_shipments_sync(o);
  if (select received_so_far from public.order_shipments where order_id = o and seq = 1) <> 27 then raise exception 'running count is every unit billed so far'; end if;
  raise exception 'ok-rollback';
exception when others then
  if sqlerrm <> 'ok-rollback' then raise; end if;
end $$;
