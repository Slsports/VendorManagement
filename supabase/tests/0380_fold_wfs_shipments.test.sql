-- 0380: folding shipment rows into one order moves their invoices and history (own dates kept), sums the cost when asked,
-- takes the last received date, remembers the rows so a sheet import leaves them out, and rebuilds the shipments.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v uuid; k uuid; p1 uuid; p2 uuid; n integer; t record;
begin
  insert into public.vendors (organization_id, name, ships_in_parts) values (v_org, 'WFS 0380', true) returning id into v;
  insert into public.orders (organization_id, vendor_id, status, po_number, source, source_key, order_date, est_cost, date_received) values (v_org, v, 'paid', 'B670380', 'placed_order_summary', 'k380', '2025-08-26', 100, '2026-03-20') returning id into k;
  insert into public.orders (organization_id, vendor_id, status, po_number, source, source_key, order_date, est_cost, date_received) values (v_org, v, 'paid', 'B670380', 'placed_order_summary', 'p380a', '2025-08-26', 50, '2026-05-13') returning id into p1;
  insert into public.orders (organization_id, vendor_id, status, po_number, source, source_key, order_date, est_cost, date_received, notes) values (v_org, v, 'paid', 'B670380', 'placed_order_summary', 'p380b', '2026-04-14', 25, '2026-04-18', 'ship-later part') returning id into p2;
  insert into public.wwd_invoices (organization_id, seq, kind, wwd_vendor_name, vendor_id, po_number, vendor_invoice_number, wwd_date, amount, paid_date, order_id) values
    (v_org, '9000380', 'invoice', 'World Famous Sports', v, 'B670380', '80380', '2026-03-20', 100, '2026-05-01', k),
    (v_org, '9000381', 'invoice', 'World Famous Sports', v, 'B670380', '80381', '2026-05-13', 50, '2026-07-01', p1),
    (v_org, '9000382', 'invoice', 'World Famous Sports', v, 'B670380', '80382', '2026-04-18', 25, '2026-06-01', p2);
  insert into public.order_status_history (order_id, from_status, to_status, changed_at) values (p1, 'received', 'paid', '2026-07-01 19:00+00');
  n := public.order_fold_parts(k, array[p1, p2], true, 'A shipment of B670380 (test).');
  if n <> 2 then raise exception 'expected 2 folded, got %', n; end if;
  select * into t from public.orders where id = k;
  if t.est_cost <> 175 or t.date_received <> '2026-05-13' then raise exception 'cost or received date wrong: % %', t.est_cost, t.date_received; end if;
  if strpos(t.notes, 'ship-later part') = 0 or strpos(t.notes, 'Folded') = 0 then raise exception 'notes not carried: %', t.notes; end if;
  if (select count(*) from public.wwd_invoices where order_id = k) <> 3 then raise exception 'invoices did not move'; end if;
  if (select count(*) from public.order_status_history where order_id = k and to_status = 'paid' and changed_at = '2026-07-01 19:00+00') <> 1 then raise exception 'history row lost its date'; end if;
  if (select count(*) from public.orders where id in (p1, p2)) <> 0 then raise exception 'parts still there'; end if;
  if (select count(*) from public.order_merges where kept_order_id = k and source_key in ('p380a', 'p380b')) <> 2 then raise exception 'merges not remembered'; end if;
  if (select count(*) from public.order_shipments where order_id = k) <> 3 then raise exception 'shipments not rebuilt'; end if;
  if (select status from public.orders where id = k) <> 'paid' then raise exception 'a paid order should stay paid'; end if;
  raise exception 'ok-rollback';
exception when others then
  if sqlerrm <> 'ok-rollback' then raise; end if;
end $$;
