-- 0379: a shipment's freight comes from Worldwide's invoice, else from Claude's reading of the vendor's invoice.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v uuid; o uuid; d uuid; inv uuid; t record;
begin
  insert into public.vendors (organization_id, name, ships_in_parts) values (v_org, 'WFS 0379', true) returning id into v;
  insert into public.orders (organization_id, vendor_id, status, po_number, source, order_date, est_cost) values (v_org, v, 'awaiting_confirmation', 'WFS0379', 'placed_order_summary', '2026-02-04', 1000) returning id into o;
  insert into public.vendor_links (organization_id, vendor_id, order_id, kind, label, storage_path, doc_number) values (v_org, v, o, 'confirmation', 'SO 0379', 'x/0379.pdf', 'S0379') returning id into d;
  update public.order_checks set status = 'done', reading = '{"lines":[{"vendor_item_id":"F-1","quantity":12},{"vendor_item_id":"F-2","quantity":24}]}'::jsonb where document_id = d;
  insert into public.wwd_invoices (organization_id, seq, kind, wwd_vendor_name, vendor_id, po_number, vendor_invoice_number, wwd_date, amount, freight_amount, order_id) values (v_org, '9000379', 'invoice', 'World Famous Sports', v, 'WFS0379', 'I90379', '2026-08-24', 1310.08, 310.08, o);
  insert into public.vendor_links (organization_id, vendor_id, order_id, kind, label, storage_path, doc_number, doc_date, doc_total) values (v_org, v, o, 'invoice', 'Invoice I90379-2', 'x/0379-2.pdf', 'I90379-2', '2026-10-30', 618.17) returning id into inv;
  update public.order_checks set status = 'to_review', reading = '{"freight":18.77,"lines":[{"vendor_item_id":"F-2","quantity":24}]}'::jsonb where document_id = inv;
  perform public.order_shipments_sync(o);
  select * into t from public.order_shipments where order_id = o and seq = 1;
  if t.freight <> 310.08 then raise exception 'WWD freight not on the shipment: %', t.freight; end if;
  select * into t from public.order_shipments where order_id = o and seq = 2;
  if t.freight <> 18.77 or t.amount <> 618.17 then raise exception 'the reading''s freight not on the shipment: % %', t.freight, t.amount; end if;
  raise exception 'ok-rollback';
exception when others then
  if sqlerrm <> 'ok-rollback' then raise; end if;
end $$;
