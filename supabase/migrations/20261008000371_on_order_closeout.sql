-- 0371 — On order, and the close-out that keeps it true (Dana, Nov 13: "I need a tab on the status for open orders. That would
-- be all orders sent, that have never been received. Since we have so many historical orders that we are still trying to
-- match up, I think the best way, at this point, is to show orders closed out if they are showing as paid in bill.com or
-- wwd." … "Go do both"). Two steps, each dated by the paper, never by the day VMS caught up:
--   1. Received: an order still Sent/Placed/Confirmed/Shipped that has a WWD invoice (WWD billed the vendor's shipment) or a
--      vendor invoice on file is received as of that invoice's date.
--   2. Paid: an order whose WWD invoices are all paid (WWD's payment date or Dana's payment sheet) is Paid as of the last
--      payment; a Bill.com-paid bill does the same (Bill.com gives no payment date, so that one carries today's).
-- Also: World Famous Sports ships one order in several shipments, the invoice number carrying -2, -3 … or the digit glued on
-- ("76302-02 … -05", "I87727, I877271, I877272"; Dana, Nov 13). An invoice whose number is an order's PO plus such a suffix
-- belongs to that order.
-- And: the Nov 3 Placed Order Summary was imported at 07:24 UTC today (1,252 orders refreshed, 12 added, 333 status moves);
-- those moves are re-dated by the sheet's own received, entered and paid dates.
set local lock_timeout = '5s';

-- ---- the history row of a move VMS makes from a paper carries the paper's date -------------------------------------------
create or replace function public.order_history_date(p_order uuid, p_to public.order_status, p_when timestamptz) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.order_status_history set changed_at = p_when
   where id = (select id from public.order_status_history where order_id = p_order and to_status = p_to order by changed_at desc limit 1)
     and changed_at > p_when;
end $$;
revoke execute on function public.order_history_date(uuid, public.order_status, timestamptz) from public, anon, authenticated;

-- ---- WFS shipments: an invoice number that is an order's PO plus a shipment suffix ----------------------------------------
create or replace function public.wwd_invoices_tie_suffix(p_org uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.wwd_invoices i set order_id = m.oid, order_set_by = 'auto', updated_at = now()
    from (
      select i2.id,
             (select (array_agg(o.id order by o.order_date desc nulls last))[1] from public.orders o
               where o.organization_id = p_org and o.vendor_id = i2.vendor_id and o.status <> 'cancelled' and length(public.po_key(o.po_number)) >= 4
                 and (public.po_key(regexp_replace(coalesce(i2.po_number, ''), '-?[0-9]{1,2}$', '')) = public.po_key(o.po_number)
                   or public.po_key(regexp_replace(coalesce(i2.vendor_invoice_number, ''), '-?[0-9]{1,2}$', '')) = public.po_key(o.po_number)
                   or public.po_key(i2.vendor_invoice_number) = public.po_key(o.po_number))
               having count(distinct o.id) >= 1) as oid
        from public.wwd_invoices i2
       where i2.organization_id = p_org and i2.order_id is null and i2.kind = 'invoice' and i2.vendor_id is not null and i2.order_set_by is distinct from 'person'
    ) m
   where m.id = i.id and m.oid is not null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.wwd_invoices_tie_suffix(uuid) from public, anon, authenticated;
grant execute on function public.wwd_invoices_tie_suffix(uuid) to service_role;

-- ---- Bill.com paid: an order received (not only entered) is paid too ---------------------------------------------------
create or replace function public.billcom_orders_paid(p_org uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with bills as (
    select b.bill_id, b.payment_status, b.invoice_number, b.vendor_name,
           public.paper_key(b.invoice_number) as ik, public.paper_key(b.raw->>'purchaseOrderNumber') as pk
      from public.billcom_bills b
     where b.organization_id = p_org and b.gone_at is null and not coalesce(b.archived, false)
  ), cand as (
    select o.id, o.vendor_id, public.paper_key(o.po_number) as opk
      from public.orders o
     where o.organization_id = p_org and o.status in ('received', 'entered', 'ready_to_pay') and o.billing_route is distinct from 'worldwide'
  ), hit as (
    select c.id as order_id, b.bill_id, b.payment_status, b.invoice_number, b.vendor_name
      from cand c
      join public.vendor_links l on l.order_id = c.id and l.kind = 'invoice'
      join bills b on b.bill_id = l.billcom_bill_id
                   or (length(b.ik) >= 4 and b.ik = public.paper_key(l.doc_number) and l.vendor_id = c.vendor_id)
    union
    select c.id, b.bill_id, b.payment_status, b.invoice_number, b.vendor_name
      from cand c
      join bills b on length(b.pk) >= 4 and b.pk = c.opk
     where (select count(*) from public.orders o2
             where o2.organization_id = p_org and o2.status <> 'cancelled' and public.paper_key(o2.po_number) = c.opk) = 1
  ), paid as (
    select order_id, string_agg(distinct invoice_number, ', ') as invs, min(vendor_name) as vname
      from hit group by order_id having bool_and(payment_status = 'PAID')
  )
  update public.orders o
     set status = 'paid', paid_via = coalesce(o.paid_via, 'billcom'), paid_ref = coalesce(o.paid_ref, p.invs),
         notes = concat_ws(' ', nullif(o.notes, ''),
                 format('Paid in Bill.com (%s%s); VMS moved it to Paid on %s. Bill.com''s list has no payment date.',
                        coalesce(p.vname || ' ', ''), coalesce('invoice ' || p.invs, 'bill'),
                        to_char(now() at time zone 'America/Los_Angeles', 'Mon DD, YYYY')))
    from paid p
   where p.order_id = o.id and o.status in ('received', 'entered', 'ready_to_pay');
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.billcom_orders_paid(uuid) from public, anon, authenticated;
grant execute on function public.billcom_orders_paid(uuid) to service_role;

-- ---- the close-out --------------------------------------------------------------------------------------------------------
create or replace function public.orders_closeout(p_org uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_received integer := 0; v_paid integer := 0; v_tied integer := 0; v_bc integer := 0; org record;
begin
  for org in select id from public.organizations where p_org is null or id = p_org loop
    v_tied := v_tied + public.wwd_invoices_tie_suffix(org.id);

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

-- ---- the sheet import's status moves carry the sheet's dates ---------------------------------------------------------------
update public.order_status_history h set changed_at = x.at
  from (select h2.id, ((case h2.to_status when 'received' then o.date_received when 'entered' then coalesce(o.date_entered_ls, o.date_received)
                             when 'ready_to_pay' then coalesce(o.date_entered_ls, o.date_received) when 'paid' then coalesce(o.paid_date, o.date_entered_ls, o.date_received) end)::timestamp + time '12:00') at time zone 'America/Los_Angeles' as at
          from public.order_status_history h2 join public.orders o on o.id = h2.order_id
         where h2.changed_at between '2026-11-13T07:24:00Z' and '2026-11-13T07:25:00Z' and h2.from_status is not null) x
 where x.id = h.id and x.at is not null and x.at < h.changed_at;

-- ---- now, and every hour -------------------------------------------------------------------------------------------------------
do $$ declare r jsonb; begin r := public.orders_closeout(); raise notice 'close-out: %', r; end $$;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'orders-closeout';
    perform cron.schedule('orders-closeout', '50 * * * *', $job$select public.orders_closeout()$job$);
  end if;
end $$;
