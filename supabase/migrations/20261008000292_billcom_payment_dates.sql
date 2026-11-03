-- 0292 — Bill.com's payment list, read by the connection (Dana, Nov 3: "Can't you see all payments in bill.com??").
--   The connection can read Bill.com's payments (process date, amount, confirmation number, status, the bills paid).
--   Each payment is kept as history on its vendor or billing company (vendor_payments, source billcom, like the Payments
--   export upload), tied to its Bill.com bill, and an order paid through Bill.com gets the real paid date.
--   Vendor or billing company only by name (billcom_match); no order is matched by amount alone here.
set local lock_timeout = '5s';

alter table public.vendor_payments add column if not exists billcom_payment_id text;
alter table public.vendor_payments add column if not exists billcom_bill_id text;
create unique index if not exists vendor_payments_billcom_once on public.vendor_payments (organization_id, billcom_payment_id, billcom_bill_id)
  where billcom_payment_id is not null;
comment on column public.vendor_payments.billcom_payment_id is 'Bill.com payment id, when read from Bill.com by the connection (Nov 3).';

-- p_rows: [{payment_id, bill_id, payee, process_date, status, amount, confirmation}]
create or replace function public.billcom_payments_save(p_org uuid, p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  r   jsonb;
  m   jsonb;
  inv text;
  n   integer := 0;
begin
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if nullif(r->>'payment_id', '') is null then continue; end if;
    select b.invoice_number into inv from public.billcom_bills b where b.organization_id = p_org and b.bill_id = r->>'bill_id';
    if exists (select 1 from public.vendor_payments vp where vp.organization_id = p_org and vp.billcom_payment_id = r->>'payment_id'
                and coalesce(vp.billcom_bill_id, '') = coalesce(r->>'bill_id', '')) then
      update public.vendor_payments vp set status = nullif(r->>'status', ''), process_date = coalesce(nullif(r->>'process_date', '')::date, vp.process_date),
             invoice_number = coalesce(vp.invoice_number, inv)
       where vp.organization_id = p_org and vp.billcom_payment_id = r->>'payment_id' and coalesce(vp.billcom_bill_id, '') = coalesce(r->>'bill_id', '');
      continue;
    end if;
    m := public.billcom_match(p_org, jsonb_build_object('payee', r->>'payee', 'invoice_number', inv, 'amount', null));
    begin
      insert into public.vendor_payments (organization_id, source, confirmation, payee, vendor_id, carrier_id, process_date, status, method, amount,
                                          invoice_number, billcom_payment_id, billcom_bill_id)
      values (p_org, 'billcom', nullif(r->>'confirmation', ''), coalesce(nullif(r->>'payee', ''), '?'), nullif(m->>'vendor_id', '')::uuid,
              nullif(m->>'carrier_id', '')::uuid, nullif(r->>'process_date', '')::date, nullif(r->>'status', ''), 'Bill.com',
              nullif(r->>'amount', '')::numeric, inv, r->>'payment_id', nullif(r->>'bill_id', ''));
      n := n + 1;
    exception when unique_violation then null;   -- the same payment came in by the Payments export upload
    end;
  end loop;
  return n;
end;
$$;
revoke execute on function public.billcom_payments_save(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.billcom_payments_save(uuid, jsonb) to service_role;

-- billcom_orders_paid (0291) now takes the payment's process date, and ties the payment to the order
create or replace function public.billcom_orders_paid(p_org uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  create temp table if not exists _bc_paid (order_id uuid primary key, invs text, vname text, paid_on date, confs text, bill_ids text[]) on commit drop;
  truncate _bc_paid;
  with bills as (
    select b.bill_id, b.payment_status, b.invoice_number, b.vendor_name,
           public.paper_key(b.invoice_number) as ik, public.paper_key(b.raw->>'purchaseOrderNumber') as pk
      from public.billcom_bills b
     where b.organization_id = p_org and b.gone_at is null and not coalesce(b.archived, false)
  ), cand as (
    select o.id, o.vendor_id, public.paper_key(o.po_number) as opk
      from public.orders o
     where o.organization_id = p_org and o.billing_route is distinct from 'worldwide'
       and (o.status in ('entered', 'ready_to_pay') or (o.status = 'paid' and o.paid_via = 'billcom' and o.paid_date is null))
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
  )
  insert into _bc_paid
  select h.order_id, string_agg(distinct h.invoice_number, ', '), min(h.vendor_name),
         (select max(vp.process_date) from public.vendor_payments vp
           where vp.organization_id = p_org and vp.billcom_bill_id = any(array_agg(h.bill_id))
             and coalesce(vp.status, '') !~* '(void|cancel|fail|return)'),
         (select string_agg(distinct vp.confirmation, ', ') from public.vendor_payments vp
           where vp.organization_id = p_org and vp.billcom_bill_id = any(array_agg(h.bill_id)) and vp.confirmation is not null
             and coalesce(vp.status, '') !~* '(void|cancel|fail|return)'),
         array_agg(h.bill_id)
    from hit h group by h.order_id having bool_and(h.payment_status = 'PAID');

  update public.orders o
     set status = 'paid', paid_via = coalesce(o.paid_via, 'billcom'), paid_date = coalesce(o.paid_date, p.paid_on),
         paid_ref = coalesce(o.paid_ref, p.confs, p.invs),
         notes = concat_ws(' ', nullif(o.notes, ''),
                 format('Paid in Bill.com%s (%s%s%s); VMS moved it to Paid on %s.%s',
                        coalesce(' ' || to_char(p.paid_on, 'Mon DD, YYYY'), ''), coalesce(p.vname || ' ', ''),
                        coalesce('invoice ' || p.invs, 'bill'), coalesce(', confirmation ' || p.confs, ''),
                        to_char(now() at time zone 'America/Los_Angeles', 'Mon DD, YYYY'),
                        case when p.paid_on is null then ' Bill.com shows it paid but VMS has not read the payment date yet.' else '' end))
    from _bc_paid p
   where p.order_id = o.id and o.status in ('entered', 'ready_to_pay');
  get diagnostics n = row_count;

  -- the payments themselves point at the order; orders already Paid from Bill.com get the date once it is read
  update public.vendor_payments vp set order_id = p.order_id
    from _bc_paid p where vp.organization_id = p_org and vp.billcom_bill_id = any(p.bill_ids) and vp.order_id is null;
  update public.orders o set paid_date = x.d
    from (select vp.order_id, max(vp.process_date) d from public.vendor_payments vp
           where vp.organization_id = p_org and vp.billcom_payment_id is not null and vp.order_id is not null
             and coalesce(vp.status, '') !~* '(void|cancel|fail|return)' group by vp.order_id) x
   where x.order_id = o.id and o.paid_via = 'billcom' and o.paid_date is null and x.d is not null;
  return n;
end;
$$;
revoke execute on function public.billcom_orders_paid(uuid) from public, anon, authenticated;
grant execute on function public.billcom_orders_paid(uuid) to service_role;

select public.billcom_orders_paid(id) from public.organizations;
