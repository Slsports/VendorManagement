-- 0372 — The close-out also honors a received date already on the order (the Nov 3 sheet gave Eastman Footwear's hikers a
-- received date of 10/19/26 while the row sat on the sheet's Open tab, so the order stayed Placed): an order still
-- Sent/Placed/Confirmed/Shipped that carries a received date is Received as of that date. Nine orders today.
set local lock_timeout = '5s';

create or replace function public.orders_closeout(p_org uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_received integer := 0; v_paid integer := 0; v_tied integer := 0; v_bc integer := 0; org record;
begin
  for org in select id from public.organizations where p_org is null or id = p_org loop
    v_tied := v_tied + public.wwd_invoices_tie_suffix(org.id);

    -- 0. a received date is already on the order (the sheet, a person): it is received as of that day
    for r in
      select o.id, o.date_received from public.orders o
       where o.organization_id = org.id and o.status in ('open', 'awaiting_confirmation', 'confirmed', 'shipped') and o.date_received is not null
    loop
      update public.orders set status = 'received',
             notes = concat_ws(E'\n', nullif(notes, ''), format('Received as of %s (the received date on the order). VMS closed it out on %s.', to_char(r.date_received, 'Mon FMDD, YYYY'), to_char(now() at time zone 'America/Los_Angeles', 'Mon FMDD, YYYY')))
       where id = r.id;
      perform public.order_history_date(r.id, 'received', (r.date_received::timestamp + time '12:00') at time zone 'America/Los_Angeles');
      v_received := v_received + 1;
    end loop;

    -- 1. received: WWD billed the shipment, or the vendor's invoice is on file
    for r in
      select o.id, o.po_number,
             (select min(w.wwd_date) from public.wwd_invoices w where w.order_id = o.id and w.kind = 'invoice') as wwd_on,
             (select string_agg(coalesce(w.vendor_invoice_number, w.seq), ', ' order by w.wwd_date) from public.wwd_invoices w where w.order_id = o.id and w.kind = 'invoice') as wwd_nos,
             (select min(coalesce(l.doc_date, l.received_at)) from public.vendor_links l where l.order_id = o.id and l.kind = 'invoice') as inv_on,
             (select string_agg(coalesce(l.doc_number, l.file_name), ', ') from public.vendor_links l where l.order_id = o.id and l.kind = 'invoice') as inv_nos
        from public.orders o
       where o.organization_id = org.id and o.status in ('open', 'awaiting_confirmation', 'confirmed', 'shipped')
         and (exists (select 1 from public.wwd_invoices w where w.order_id = o.id and w.kind = 'invoice')
              or exists (select 1 from public.vendor_links l where l.order_id = o.id and l.kind = 'invoice'))
    loop
      update public.orders set status = 'received', date_received = coalesce(date_received, r.wwd_on, r.inv_on),
             notes = concat_ws(E'\n', nullif(notes, ''),
               case when r.wwd_on is not null then format('Received as of %s: Worldwide billed the shipment (invoice %s). VMS closed it out on %s.', to_char(coalesce(r.wwd_on, r.inv_on), 'Mon FMDD, YYYY'), r.wwd_nos, to_char(now() at time zone 'America/Los_Angeles', 'Mon FMDD, YYYY'))
                    else format('Received as of %s: the vendor''s invoice %s is on file. VMS closed it out on %s.', to_char(r.inv_on, 'Mon FMDD, YYYY'), r.inv_nos, to_char(now() at time zone 'America/Los_Angeles', 'Mon FMDD, YYYY')) end)
       where id = r.id;
      perform public.order_history_date(r.id, 'received', ((coalesce(r.wwd_on, r.inv_on))::timestamp + time '12:00') at time zone 'America/Los_Angeles');
      v_received := v_received + 1;
    end loop;

    -- 2. paid: every WWD invoice on the order is paid
    for r in
      select o.id,
             (select max(coalesce(w.paid_date, w.sheet_paid_date)) from public.wwd_invoices w where w.order_id = o.id and w.kind = 'invoice') as paid_on,
             (select sum(coalesce(w.paid_amount, w.amount)) from public.wwd_invoices w where w.order_id = o.id and w.kind = 'invoice') as amt,
             (select string_agg(coalesce(w.vendor_invoice_number, w.seq), ', ' order by w.wwd_date) from public.wwd_invoices w where w.order_id = o.id and w.kind = 'invoice') as nos
        from public.orders o
       where o.organization_id = org.id and o.status in ('received', 'entered', 'ready_to_pay')
         and exists (select 1 from public.wwd_invoices w where w.order_id = o.id and w.kind = 'invoice')
         and not exists (select 1 from public.wwd_invoices w where w.order_id = o.id and w.kind = 'invoice' and w.paid_date is null and w.sheet_paid_date is null)
    loop
      update public.orders set status = 'paid', paid_date = coalesce(paid_date, r.paid_on), paid_via = coalesce(paid_via, 'wwd'),
             final_cost = coalesce(final_cost, r.amt),
             notes = concat_ws(E'\n', nullif(notes, ''), format('Paid %s through Worldwide (invoice %s%s). VMS closed it out on %s.', to_char(r.paid_on, 'Mon FMDD, YYYY'), r.nos, coalesce(', $' || to_char(r.amt, 'FM999,999,990.00'), ''), to_char(now() at time zone 'America/Los_Angeles', 'Mon FMDD, YYYY')))
       where id = r.id;
      perform public.order_history_date(r.id, 'paid', (r.paid_on::timestamp + time '12:00') at time zone 'America/Los_Angeles');
      v_paid := v_paid + 1;
    end loop;

    -- 3. paid in Bill.com
    v_bc := v_bc + public.billcom_orders_paid(org.id);
  end loop;
  return jsonb_build_object('received', v_received, 'paid_wwd', v_paid, 'paid_billcom', v_bc, 'invoices_tied', v_tied);
end $$;
revoke execute on function public.orders_closeout(uuid) from public, anon, authenticated;
grant execute on function public.orders_closeout(uuid) to service_role;

do $$ declare r jsonb; begin r := public.orders_closeout(); raise notice 'close-out: %', r; end $$;
