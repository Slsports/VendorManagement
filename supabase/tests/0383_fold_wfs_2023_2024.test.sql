-- 0383: a paid order's final cost is Worldwide's invoice total; an open invoice leaves it alone.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v uuid; o uuid; x numeric;
begin
  insert into public.vendors (organization_id, name) values (v_org, 'WFS 0382') returning id into v;
  insert into public.orders (organization_id, vendor_id, status, po_number, source, order_date, est_cost) values (v_org, v, 'paid', 'P0382', 'placed_order_summary', '2024-09-11', 1893.76) returning id into o;
  insert into public.wwd_invoices (organization_id, seq, kind, wwd_vendor_name, vendor_id, po_number, vendor_invoice_number, wwd_date, amount, paid_date, order_id) values
    (v_org, '9000386', 'invoice', 'World Famous Sports', v, 'P0382', '68259', '2024-09-13', 1893.76, '2024-11-01', o),
    (v_org, '9000387', 'invoice', 'World Famous Sports', v, 'P0382', '68259-02', '2024-10-16', 1789.12, null, o);
  x := public.order_fold_final_cost(o);
  if x is not null or (select final_cost from public.orders where id = o) is not null then raise exception 'an open invoice should leave the final cost alone'; end if;
  update public.wwd_invoices set sheet_paid_date = '2024-12-01' where seq = '9000387';
  x := public.order_fold_final_cost(o);
  if x <> 3682.88 or (select final_cost from public.orders where id = o) <> 3682.88 then raise exception 'final cost not the invoice total: %', x; end if;
  raise exception 'ok-rollback';
exception when others then
  if sqlerrm <> 'ok-rollback' then raise; end if;
end $$;
