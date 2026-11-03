-- 0291 — A paid order leaves Payments due (Dana, Nov 3: "Have the payments due card been matched against all the WWD
--   payments and bill.com payments??"; "go on 1, 2 and 3").
--   Confirmed cause: the Order Guide import (Oct 6) put orders on their sheet tab ("2-Entered") together with the sheet's
--   paid date, and the WWD step only moves an order to Paid when it has no paid date yet, so 183 paid orders stayed on
--   the card. Bill.com was never matched to orders at all.
--   1. An order that gets a paid date while Entered or Ready to pay moves to Paid (any source: WWD upload, sheet, by hand).
--   2. billcom_orders_paid: a bill Bill.com shows PAID pays the order it belongs to: the order's own invoice paper is that
--      bill (linked by the Bill.com check, or the same invoice number from the same vendor), or the bill carries our PO
--      and exactly one order has that PO. Bill.com's bill list has no payment date, so none is made up; the note says so.
--   3. Back-fix of the orders already on file, with a note on each.
set local lock_timeout = '5s';

create or replace function public.orders_paid_moves_status() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.paid_date is not null and new.status in ('entered', 'ready_to_pay')
     and (tg_op = 'INSERT' or old.paid_date is null) then
    new.status := 'paid';
  end if;
  return new;
end;
$$;
revoke execute on function public.orders_paid_moves_status() from public, anon, authenticated;
drop trigger if exists orders_paid_moves_status on public.orders;
create trigger orders_paid_moves_status before insert or update of paid_date on public.orders
  for each row execute function public.orders_paid_moves_status();

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
     where o.organization_id = p_org and o.status in ('entered', 'ready_to_pay') and o.billing_route is distinct from 'worldwide'
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
   where p.order_id = o.id and o.status in ('entered', 'ready_to_pay');
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.billcom_orders_paid(uuid) from public, anon, authenticated;
grant execute on function public.billcom_orders_paid(uuid) to service_role;

-- Back-fix: orders that already carry a paid date but sit on Entered / Ready to pay
update public.orders o
   set status = 'paid',
       notes = concat_ws(' ', nullif(o.notes, ''), format('Moved to Paid Nov 3, 2026: paid %s%s, per %s.',
               to_char(o.paid_date, 'Mon DD, YYYY'), coalesce(' (WWD ' || nullif(o.paid_ref, '') || ')', ''),
               case when exists (select 1 from public.wwd_invoices i where i.order_id = o.id and i.kind = 'invoice')
                    then 'the WWD payment records (every WWD invoice on it is paid)'
                    else 'the paid date on your Order Guide sheet' end))
 where o.paid_date is not null and o.status in ('entered', 'ready_to_pay')
   and not exists (select 1 from public.wwd_invoices i where i.order_id = o.id and i.kind = 'invoice'
                    and i.paid_date is null and i.sheet_paid_date is null);

select public.billcom_orders_paid(id) from public.organizations;
