-- 0061 — Bill.com payment history (Dana, Oct 9): upload Bill.com's Payments export (confirmation number,
-- vendor, process date, status, method, amount, arrival date, invoice number, paid from). Each payment is
-- matched: freight bills by billing company and invoice number (else the only unpaid bill for that amount),
-- vendor orders by invoice/PO number or the only unpaid order for that amount. A person sees the preview
-- and imports; every payment is kept as history on its vendor (or billing company) either way.
create table if not exists public.vendor_payments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  source           text not null default 'billcom' check (source in ('billcom', 'manual')),
  confirmation     text,
  payee            text not null,
  vendor_id        uuid references public.vendors(id) on delete set null,
  carrier_id       uuid references public.carriers(id) on delete set null,
  process_date     date,
  arrival_date     date,
  status           text,
  method           text,
  amount           numeric(12,2),
  invoice_number   text,
  paid_from        text,
  freight_bill_id  uuid references public.freight_bills(id) on delete set null,
  order_id         uuid references public.orders(id) on delete set null,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create unique index if not exists vendor_payments_once on public.vendor_payments (organization_id, source, coalesce(confirmation, ''), coalesce(invoice_number, ''), coalesce(amount, 0));
create index if not exists vendor_payments_vendor_idx on public.vendor_payments (vendor_id, process_date desc);
create index if not exists vendor_payments_carrier_idx on public.vendor_payments (carrier_id, process_date desc);
alter table public.vendor_payments enable row level security;
drop policy if exists "vendor_payments: members read" on public.vendor_payments;
create policy "vendor_payments: members read" on public.vendor_payments for select to authenticated using (public.user_in_org(organization_id));
grant select on table public.vendor_payments to authenticated;
grant all on table public.vendor_payments to service_role;

alter table public.freight_bills drop constraint if exists freight_bills_paid_source_check;
alter table public.freight_bills add constraint freight_bills_paid_source_check check (paid_source in ('manual', 'receipt', 'email', 'billcom'));

-- "PartnerShip LLC" / "Priority1 Inc." → partnership / priority1: for comparing payee names.
create or replace function public.payee_key(p text) returns text language sql immutable as $$
  select regexp_replace(regexp_replace(regexp_replace(lower(coalesce(p, '')), '\m(inc|llc|l\.l\.c|co|corp|corporation|company|ltd|the)\M\.?', '', 'g'), '\mone\M', '1', 'g'), '[^a-z0-9]', '', 'g')
$$;

-- One row of the export → what it matches. p_row: {payee, invoice_number, amount, process_date}.
create or replace function public.billcom_match(p_org uuid, p_row jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare
  k        text := public.payee_key(p_row->>'payee');
  inv      text := nullif(trim(p_row->>'invoice_number'), '');
  amt      numeric := nullif(p_row->>'amount', '')::numeric;
  v_car    uuid;
  v_bill   uuid;
  v_vendor uuid;
  v_order  uuid;
  ids      uuid[];
begin
  if length(k) < 3 then return '{}'::jsonb; end if;
  -- a billing company
  select array_agg(c.id) into ids from public.carriers c
   where c.organization_id = p_org and c.role = 'billing'
     and (public.payee_key(split_part(c.name, ' (', 1)) = k or (length(k) >= 5 and (k like public.payee_key(split_part(c.name, ' (', 1)) || '%' or public.payee_key(c.name) like k || '%')));
  if cardinality(ids) = 1 then
    v_car := ids[1];
    if inv is not null and lower(inv) <> 'multiple' then
      select (array_agg(b.id))[1] into v_bill from public.freight_bills b where b.carrier_id = v_car and public.inv_key(b.invoice_number) = public.inv_key(inv) having count(*) = 1;
    end if;
    if v_bill is null and amt is not null then
      select (array_agg(b.id))[1] into v_bill from public.freight_bills b where b.carrier_id = v_car and b.paid_date is null and b.total = amt having count(*) = 1;
    end if;
  else
    -- a vendor: exact name or alias, else one vendor whose name starts with it
    select array_agg(distinct v.id) into ids from public.vendors v
     where v.organization_id = p_org and (public.payee_key(v.name) = k or exists (select 1 from unnest(v.aliases) a where public.payee_key(a) = k));
    if coalesce(cardinality(ids), 0) = 0 and length(k) >= 6 then
      select array_agg(v.id) into ids from public.vendors v where v.organization_id = p_org and v.is_active and public.payee_key(v.name) like k || '%';
    end if;
    if cardinality(ids) = 1 then
      v_vendor := ids[1];
      if inv is not null and lower(inv) <> 'multiple' then
        select (array_agg(o.id))[1] into v_order from public.orders o where o.vendor_id = v_vendor and public.po_key(o.po_number) = public.po_key(inv) having count(*) = 1;
      end if;
      if v_order is null and amt is not null then
        select (array_agg(o.id))[1] into v_order from public.orders o where o.vendor_id = v_vendor and o.paid_date is null and coalesce(o.final_cost, o.est_cost) = amt having count(*) = 1;
      end if;
    end if;
  end if;
  return jsonb_build_object(
    'carrier_id', v_car, 'carrier', (select name from public.carriers where id = v_car),
    'bill_id', v_bill, 'bill', (select coalesce('#' || invoice_number, 'bill') || ' · $' || coalesce(total::text, '?') from public.freight_bills where id = v_bill),
    'bill_paid', (select paid_date is not null from public.freight_bills where id = v_bill),
    'vendor_id', v_vendor, 'vendor', (select name from public.vendors where id = v_vendor),
    'order_id', v_order, 'order', (select concat_ws(' · ', to_char(order_date, 'Mon FMDD, YYYY'), po_number, '$' || coalesce(final_cost, est_cost)::text) from public.orders where id = v_order),
    'order_paid', (select paid_date is not null from public.orders where id = v_order),
    'already', exists (select 1 from public.vendor_payments vp where vp.organization_id = p_org and vp.source = 'billcom'
                        and coalesce(vp.confirmation, '') = coalesce(p_row->>'confirmation', '') and coalesce(vp.invoice_number, '') = coalesce(inv, '') and coalesce(vp.amount, 0) = coalesce(amt, 0)));
end;
$$;

create or replace function public.billcom_preview(p_rows jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare v_org uuid := public.current_user_org();
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers import payments' using errcode = '42501'; end if;
  return (select coalesce(jsonb_agg(public.billcom_match(v_org, r) order by ord), '[]'::jsonb) from jsonb_array_elements(p_rows) with ordinality as x(r, ord));
end;
$$;
revoke execute on function public.billcom_preview(jsonb) from public, anon;
grant execute on function public.billcom_preview(jsonb) to authenticated, service_role;

-- Import the rows a person kept: history for every one, and the matched bill or order marked paid.
create or replace function public.billcom_import(p_rows jsonb)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_user_org();
  r     jsonb;
  m     jsonb;
  n     integer := 0;
  v_id  uuid;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers import payments' using errcode = '42501'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    m := public.billcom_match(v_org, r);
    insert into public.vendor_payments (organization_id, source, confirmation, payee, vendor_id, carrier_id, process_date, arrival_date, status, method, amount, invoice_number, paid_from, freight_bill_id, order_id, created_by)
    values (v_org, 'billcom', nullif(r->>'confirmation', ''), coalesce(nullif(r->>'payee', ''), '?'), nullif(m->>'vendor_id', '')::uuid, nullif(m->>'carrier_id', '')::uuid,
            nullif(r->>'process_date', '')::date, nullif(r->>'arrival_date', '')::date, nullif(r->>'status', ''), nullif(r->>'method', ''),
            nullif(r->>'amount', '')::numeric, nullif(r->>'invoice_number', ''), nullif(r->>'paid_from', ''),
            nullif(m->>'bill_id', '')::uuid, nullif(m->>'order_id', '')::uuid, auth.uid())
    on conflict do nothing
    returning id into v_id;
    if v_id is null then continue; end if;
    n := n + 1;
    if m->>'bill_id' is not null then
      update public.freight_bills set paid_date = coalesce(paid_date, nullif(r->>'process_date', '')::date), paid_via = coalesce(paid_via, 'billcom'),
             paid_ref = coalesce(paid_ref, nullif(r->>'confirmation', '')), paid_source = coalesce(paid_source, 'billcom'), paid_by = coalesce(paid_by, auth.uid())
       where id = (m->>'bill_id')::uuid;
    end if;
    if m->>'order_id' is not null then
      update public.orders set paid_date = coalesce(paid_date, nullif(r->>'process_date', '')::date), paid_via = coalesce(paid_via, 'billcom'),
             paid_ref = coalesce(paid_ref, nullif(r->>'confirmation', '')),
             status = case when status in ('entered', 'ready_to_pay') then 'paid'::public.order_status else status end
       where id = (m->>'order_id')::uuid;
    end if;
  end loop;
  return n;
end;
$$;
revoke execute on function public.billcom_import(jsonb) from public, anon;
grant execute on function public.billcom_import(jsonb) to authenticated, service_role;
