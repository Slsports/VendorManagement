-- 0371: a live order with a WWD invoice is received as of the invoice; all its WWD invoices paid makes it Paid as of the last
-- payment; a WFS shipment invoice (PO plus a suffix) ties to the order; the history rows carry the papers' dates.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v uuid; o1 uuid; o2 uuid; r jsonb; t record;
begin
  insert into public.vendors (organization_id, name) values (v_org, 'WFS 0371') returning id into v;
  insert into public.orders (organization_id, vendor_id, status, po_number, source, order_date, est_cost) values (v_org, v, 'awaiting_confirmation', 'B670371', 'placed_order_summary', '2026-02-04', 1000) returning id into o1;
  insert into public.orders (organization_id, vendor_id, status, po_number, source, order_date, est_cost) values (v_org, v, 'open', 'WFS0371B', 'email', '2026-09-01', 500) returning id into o2;
  -- WWD billed two shipments of the first order, the second under the suffixed number; both paid
  insert into public.wwd_invoices (organization_id, seq, kind, wwd_vendor_name, vendor_id, po_number, vendor_invoice_number, wwd_date, amount, paid_date, order_id)
  values (v_org, '9000371', 'invoice', 'World Famous Sports', v, 'B670371', '88371', '2026-03-20', 600, '2026-05-01', o1);
  insert into public.wwd_invoices (organization_id, seq, kind, wwd_vendor_name, vendor_id, po_number, vendor_invoice_number, wwd_date, amount, sheet_paid_date)
  values (v_org, '9000372', 'invoice', 'World Famous Sports', v, 'B670371-2', '88371-2', '2026-04-15', 400, '2026-06-01');
  r := public.orders_closeout(v_org);
  if (select order_id from public.wwd_invoices where seq = '9000372') <> o1 then raise exception 'the -2 shipment did not tie to the order: %', r; end if;
  select * into t from public.orders where id = o1;
  if t.status <> 'paid' or t.date_received <> '2026-03-20' or t.paid_date <> '2026-06-01' or t.paid_via <> 'wwd' then raise exception 'order not received then paid: % % % %', t.status, t.date_received, t.paid_date, t.paid_via; end if;
  if (select (changed_at at time zone 'America/Los_Angeles')::date from public.order_status_history where order_id = o1 and to_status = 'received') <> '2026-03-20' then raise exception 'received history not dated by the invoice'; end if;
  if (select (changed_at at time zone 'America/Los_Angeles')::date from public.order_status_history where order_id = o1 and to_status = 'paid') <> '2026-06-01' then raise exception 'paid history not dated by the payment'; end if;
  -- an order with nothing billed stays on order
  if (select status from public.orders where id = o2) <> 'open' then raise exception 'an unbilled order moved'; end if;
  -- a WWD invoice billed but not paid: received, not paid
  insert into public.wwd_invoices (organization_id, seq, kind, wwd_vendor_name, vendor_id, po_number, vendor_invoice_number, wwd_date, amount, order_id)
  values (v_org, '9000373', 'invoice', 'World Famous Sports', v, 'WFS0371B', '88372', '2026-10-10', 500, o2);
  r := public.orders_closeout(v_org);
  select * into t from public.orders where id = o2;
  if t.status <> 'received' or t.date_received <> '2026-10-10' then raise exception 'billed order not received: %', t.status; end if;
  raise exception 'ok-rollback';
exception when others then
  if sqlerrm <> 'ok-rollback' then raise; end if;
end $$;
