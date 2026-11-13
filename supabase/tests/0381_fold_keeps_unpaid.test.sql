-- 0381: a paid part folded into an order with an unpaid invoice leaves the order where it was.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v uuid; k uuid; p1 uuid; n integer;
begin
  insert into public.vendors (organization_id, name, ships_in_parts) values (v_org, 'WFS 0381', true) returning id into v;
  insert into public.orders (organization_id, vendor_id, status, po_number, source, source_key, order_date, est_cost, date_received) values (v_org, v, 'entered', 'I80381', 'placed_order_summary', 'k381', '2026-02-05', 239.40, '2026-08-18') returning id into k;
  insert into public.orders (organization_id, vendor_id, status, po_number, source, source_key, order_date, est_cost, date_received, paid_date) values (v_org, v, 'paid', 'WORLD0381', 'placed_order_summary', 'p381', '2026-02-05', 726.96, '2026-09-28', '2026-10-08') returning id into p1;
  insert into public.wwd_invoices (organization_id, seq, kind, wwd_vendor_name, vendor_id, po_number, vendor_invoice_number, wwd_date, amount, sheet_paid_date, order_id) values
    (v_org, '9000383', 'invoice', 'World Famous Sports', v, 'I80381', 'I80381', '2026-08-18', 239.40, '2026-10-08', k),
    (v_org, '9000384', 'invoice', 'World Famous Sports', v, 'I80381-2', 'I803812', '2026-09-25', 726.96, '2026-10-08', p1),
    (v_org, '9000385', 'invoice', 'World Famous Sports', v, 'I80381-3', 'I803813', '2026-10-01', 838.20, null, k);
  n := public.order_fold_parts(k, array[p1], true, 'test');
  if (select status from public.orders where id = k) <> 'entered' then raise exception 'the fold paid an order with an open invoice: %', (select status from public.orders where id = k); end if;
  if (select count(*) from public.order_status_history where order_id = k and to_status = 'paid') <> 0 then raise exception 'a Paid history row was left'; end if;
  if (select est_cost from public.orders where id = k) <> 966.36 then raise exception 'cost not summed'; end if;
  raise exception 'ok-rollback';
exception when others then
  if sqlerrm <> 'ok-rollback' then raise; end if;
end $$;
