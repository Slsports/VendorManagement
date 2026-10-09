-- 0064 — WWD invoices and payments (Dana, Oct 9). Worldwide's portals never show the whole picture:
--   * Payment History export: every payment (PB number, date, total) and the WWD invoice numbers it paid,
--     no vendor names;
--   * EdenRed invoice export (Nov 2025 on): WWD's sequence number with our PO, the vendor, the vendor's own
--     invoice number, amount, terms and due date;
--   * Dana's pasted payment sheets (2024 on): WWD invoice number, vendor, amounts and discounts.
-- Each WWD number is one invoice here (a credit or debit reuses the number of the invoice it adjusts, so
-- the key is number + kind). Imports only fill in: a later file never erases what an earlier one gave.
-- Vendors come from the names (vendor aliases learn a WWD spelling once Dana picks the vendor), credits
-- and debits take the vendor of the invoice with the same number, the $275 monthly membership fee files
-- under Worldwide. Orders link by our PO, else the vendor's only unpaid order for that amount; an order
-- whose WWD invoices are paid is marked paid with the payment number.
--
-- Freight allowance (Dana, Oct 9): some vendors credit the freight back when the invoice is paid on time.
-- The order keeps the amount and the pay-by date; the dashboard warns before the date; the credit, when
-- it comes through WWD, marks it received.

-- ---------- freight allowance ----------
alter table public.orders add column if not exists freight_allowance numeric(12,2);
alter table public.orders add column if not exists freight_allowance_pay_by date;
alter table public.orders add column if not exists freight_allowance_received date;
alter table public.vendors add column if not exists freight_allowance_on_time boolean not null default false;
create index if not exists orders_freight_allowance_idx on public.orders (organization_id, freight_allowance_pay_by) where freight_allowance is not null and paid_date is null;

-- ---------- tables ----------
create table if not exists public.wwd_payments (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  ref              text not null,
  pay_date         date not null,
  total            numeric(12,2),
  created_at       timestamptz not null default now(),
  unique (organization_id, ref, pay_date)
);

create table if not exists public.wwd_invoices (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete restrict,
  seq                    text not null,
  kind                   text not null check (kind in ('invoice', 'credit', 'debit', 'fee')),
  wwd_date               date,
  wwd_vendor_name        text,
  vendor_id              uuid references public.vendors(id) on delete set null,
  vendor_set_by          text check (vendor_set_by in ('auto', 'person')),
  po_number              text,
  vendor_invoice_number  text,
  vendor_invoice_date    date,
  amount                 numeric(12,2),
  discount               numeric(12,2),
  due_date               date,
  terms                  text,
  freight_amount         numeric(12,2),
  sheet_paid_date        date,
  paid_amount            numeric(12,2),
  paid_date              date,
  order_id               uuid references public.orders(id) on delete set null,
  order_set_by           text check (order_set_by in ('auto', 'person')),
  sources                text[] not null default '{}',
  note                   text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (organization_id, seq, kind)
);
create index if not exists wwd_invoices_vendor_idx on public.wwd_invoices (vendor_id, wwd_date desc);
create index if not exists wwd_invoices_order_idx on public.wwd_invoices (order_id);
create index if not exists wwd_invoices_name_idx on public.wwd_invoices (organization_id, lower(wwd_vendor_name)) where vendor_id is null;

create table if not exists public.wwd_payment_lines (
  id          uuid primary key default gen_random_uuid(),
  payment_id  uuid not null references public.wwd_payments(id) on delete cascade,
  invoice_id  uuid not null references public.wwd_invoices(id) on delete cascade,
  amount      numeric(12,2) not null,
  unique (payment_id, invoice_id, amount)
);
create index if not exists wwd_payment_lines_invoice_idx on public.wwd_payment_lines (invoice_id);

alter table public.wwd_payments enable row level security;
alter table public.wwd_invoices enable row level security;
alter table public.wwd_payment_lines enable row level security;
drop policy if exists "wwd_payments: members read" on public.wwd_payments;
create policy "wwd_payments: members read" on public.wwd_payments for select to authenticated using (public.user_in_org(organization_id));
drop policy if exists "wwd_invoices: members read" on public.wwd_invoices;
create policy "wwd_invoices: members read" on public.wwd_invoices for select to authenticated using (public.user_in_org(organization_id));
drop policy if exists "wwd_payment_lines: members read" on public.wwd_payment_lines;
create policy "wwd_payment_lines: members read" on public.wwd_payment_lines for select to authenticated
  using (exists (select 1 from public.wwd_payments p where p.id = payment_id and public.user_in_org(p.organization_id)));
grant select on table public.wwd_payments, public.wwd_invoices, public.wwd_payment_lines to authenticated;
grant all on table public.wwd_payments, public.wwd_invoices, public.wwd_payment_lines to service_role;

-- ---------- matching ----------
-- Worldwide itself: its own vendor record (warehouse orders, the membership fee, "Worldwide Distributors Inc").
create or replace function public.wwd_self_vendor(p_org uuid) returns uuid language sql stable security definer set search_path = public as $$
  select id from public.vendors where organization_id = p_org and upper(name) = 'WORLDWIDE' order by is_active desc, created_at limit 1
$$;

-- A WWD vendor spelling → one vendor: name or alias, then one of its "/" parts, then the only active vendor
-- whose name starts with it. Null when unsure (a person picks once; the spelling becomes an alias).
create or replace function public.wwd_vendor_for(p_org uuid, p_name text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  k    text := public.payee_key(p_name);
  ids  uuid[];
  part text;
begin
  if p_name is null or length(k) < 2 then return null; end if;
  if p_name ~* '^(worldwide (distributors|buying group)|wwd dues|wwd)\M' then return public.wwd_self_vendor(p_org); end if;
  select array_agg(distinct v.id) into ids from public.vendors v
   where v.organization_id = p_org and (public.payee_key(v.name) = k or exists (select 1 from unnest(v.aliases) a where public.payee_key(a) = k));
  if cardinality(ids) = 1 then return ids[1]; end if;
  if cardinality(ids) > 1 then
    select array_agg(v.id) into ids from public.vendors v where v.id = any (ids) and v.is_active;
    return case when cardinality(ids) = 1 then ids[1] end;
  end if;
  foreach part in array regexp_split_to_array(p_name, '\s*/\s*') loop
    k := public.payee_key(part);
    continue when length(k) < 4 or part = p_name;
    select array_agg(distinct v.id) into ids from public.vendors v
     where v.organization_id = p_org and v.is_active and (public.payee_key(v.name) = k or exists (select 1 from unnest(v.aliases) a where public.payee_key(a) = k));
    if cardinality(ids) = 1 then return ids[1]; end if;
  end loop;
  k := public.payee_key(p_name);
  if length(k) >= 6 then
    select array_agg(v.id) into ids from public.vendors v where v.organization_id = p_org and v.is_active and public.payee_key(v.name) like k || '%';
    if cardinality(ids) = 1 then return ids[1]; end if;
  end if;
  return null;
end;
$$;

-- Vendors, orders, paid amounts and paid orders for every WWD invoice of the organization. Never undoes
-- what a person set. Returns the number of orders it marked paid.
create or replace function public.wwd_relink(p_org uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_self uuid := public.wwd_self_vendor(p_org);
  n      integer;
begin
  -- paid so far, from the payment lines
  update public.wwd_invoices i set paid_amount = s.amt, paid_date = s.last, updated_at = now()
    from (select l.invoice_id, sum(l.amount) as amt, max(p.pay_date) as last from public.wwd_payment_lines l join public.wwd_payments p on p.id = l.payment_id group by l.invoice_id) s
   where s.invoice_id = i.id and i.organization_id = p_org and (i.paid_amount is distinct from s.amt or i.paid_date is distinct from s.last);
  -- vendors: by name, the fee, then the invoice a credit or debit adjusts
  -- (each spelling is looked up once; an invoice placed automatically keeps its vendor unless the name changes)
  update public.wwd_invoices i set vendor_id = v_self, vendor_set_by = 'auto', updated_at = now()
   where i.organization_id = p_org and i.kind = 'fee' and i.vendor_id is null and v_self is not null;
  update public.wwd_invoices i set vendor_id = m.vid, vendor_set_by = 'auto', updated_at = now()
    from (select x.nm, public.wwd_vendor_for(p_org, x.nm) as vid
            from (select distinct wwd_vendor_name as nm from public.wwd_invoices
                   where organization_id = p_org and vendor_id is null and wwd_vendor_name is not null and vendor_set_by is distinct from 'person') x) m
   where i.organization_id = p_org and i.vendor_id is null and i.wwd_vendor_name = m.nm and m.vid is not null and i.vendor_set_by is distinct from 'person';
  update public.wwd_invoices i set vendor_id = src.vendor_id, vendor_set_by = 'auto', updated_at = now()
    from public.wwd_invoices src
   where i.organization_id = p_org and i.kind in ('credit', 'debit') and i.vendor_id is null
     and src.organization_id = p_org and src.seq = i.seq and src.kind = 'invoice' and src.vendor_id is not null;
  -- orders: our PO with that vendor, else the vendor's only unpaid order for that amount
  update public.wwd_invoices i set order_id = o.oid, order_set_by = 'auto', updated_at = now()
    from (select i2.id, (select (array_agg(o.id))[1] from public.orders o
                          where o.vendor_id = i2.vendor_id and public.po_key(o.po_number) = public.po_key(i2.po_number) having count(*) = 1) as oid
            from public.wwd_invoices i2 where i2.organization_id = p_org and i2.order_id is null and i2.kind = 'invoice' and i2.vendor_id is not null and public.po_key(i2.po_number) is not null) o
   where o.id = i.id and o.oid is not null;
  update public.wwd_invoices i set order_id = o.oid, order_set_by = 'auto', updated_at = now()
    from (select i2.id, (select (array_agg(o.id))[1] from public.orders o
                          where o.vendor_id = i2.vendor_id and o.paid_date is null and o.status <> 'cancelled' and coalesce(o.final_cost, o.est_cost) = i2.amount
                            and not exists (select 1 from public.wwd_invoices x where x.order_id = o.id) having count(*) = 1) as oid
            from public.wwd_invoices i2 where i2.organization_id = p_org and i2.order_id is null and i2.kind = 'invoice' and i2.vendor_id is not null and i2.amount is not null) o
   where o.id = i.id and o.oid is not null;
  update public.wwd_invoices i set order_id = src.order_id, order_set_by = 'auto', updated_at = now()
    from public.wwd_invoices src
   where i.organization_id = p_org and i.kind in ('credit', 'debit') and i.order_id is null
     and src.organization_id = p_org and src.seq = i.seq and src.kind = 'invoice' and src.order_id is not null and src.vendor_id is not distinct from i.vendor_id;
  -- a credit on an order with a freight allowance: the allowance came through
  update public.orders o set freight_allowance_received = c.d
    from (select order_id, min(coalesce(wwd_date, paid_date)) as d from public.wwd_invoices where organization_id = p_org and kind = 'credit' and order_id is not null group by order_id) c
   where c.order_id = o.id and o.freight_allowance is not null and o.freight_allowance_received is null and c.d is not null;
  -- orders whose WWD invoices are all paid
  with paid as (
    select i.order_id, max(coalesce(i.paid_date, i.sheet_paid_date)) as d,
           string_agg(distinct p.ref, ', ') filter (where p.ref is not null) as refs
      from public.wwd_invoices i
      left join public.wwd_payment_lines l on l.invoice_id = i.id
      left join public.wwd_payments p on p.id = l.payment_id
     where i.organization_id = p_org and i.order_id is not null and i.kind = 'invoice'
     group by i.order_id
    having bool_and(i.paid_date is not null or i.sheet_paid_date is not null)
  )
  update public.orders o set paid_date = paid.d, paid_via = coalesce(o.paid_via, 'wwd'), paid_ref = coalesce(o.paid_ref, paid.refs),
         status = case when o.status in ('entered', 'ready_to_pay', 'received') then 'paid'::public.order_status else o.status end
    from paid where paid.order_id = o.id and o.paid_date is null and paid.d is not null;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.wwd_relink(uuid) from public, anon, authenticated;
grant execute on function public.wwd_relink(uuid) to service_role;

-- ---------- import ----------
-- p: { invoices: [{seq, kind?, wwd_date, vendor_name, po_number, vendor_invoice_number, vendor_invoice_date, amount,
--                  discount, due_date, terms, freight_amount, sheet_paid_date, source}],
--      payments: [{ref, pay_date, total}], lines: [{ref, pay_date, seq, amount, wwd_date}] }
create or replace function public.wwd_kind(p_seq text, p_amount numeric, p_kind text, p_vendor text) returns text language sql immutable as $$
  select case
    when p_kind in ('credit', 'debit') then p_kind
    when p_amount = 275 and p_seq ~ '^17' and (nullif(trim(p_vendor), '') is null or p_vendor ~* 'dues') then 'fee'
    when p_kind in ('invoice', 'fee') then p_kind
    when p_amount < 0 then 'credit'
    else 'invoice' end
$$;

create or replace function public.wwd_preview(p jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.current_user_org();
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers import WWD payments' using errcode = '42501'; end if;
  return jsonb_build_object(
    'invoices', (select count(distinct (ltrim(r->>'seq', '0'), public.wwd_kind(ltrim(r->>'seq', '0'), nullif(r->>'amount', '')::numeric, r->>'kind', r->>'vendor_name'))) from jsonb_array_elements(coalesce(p->'invoices', '[]')) r),
    'invoices_new', (select count(distinct (ltrim(r->>'seq', '0'), public.wwd_kind(ltrim(r->>'seq', '0'), nullif(r->>'amount', '')::numeric, r->>'kind', r->>'vendor_name'))) from jsonb_array_elements(coalesce(p->'invoices', '[]')) r
                      where not exists (select 1 from public.wwd_invoices i where i.organization_id = v_org and i.seq = ltrim(r->>'seq', '0')
                                          and i.kind = public.wwd_kind(ltrim(r->>'seq', '0'), nullif(r->>'amount', '')::numeric, r->>'kind', r->>'vendor_name'))),
    'payments', (select count(*) from jsonb_array_elements(coalesce(p->'payments', '[]')) r),
    'payments_new', (select count(*) from jsonb_array_elements(coalesce(p->'payments', '[]')) r
                      where not exists (select 1 from public.wwd_payments x where x.organization_id = v_org and x.ref = r->>'ref' and x.pay_date = (r->>'pay_date')::date)),
    'lines', (select count(*) from jsonb_array_elements(coalesce(p->'lines', '[]')) r),
    'names', (select coalesce(jsonb_agg(jsonb_build_object('name', n, 'count', c, 'vendor', (select name from public.vendors where id = public.wwd_vendor_for(v_org, n))) order by n), '[]')
                from (select trim(r->>'vendor_name') as n, count(*) as c from jsonb_array_elements(coalesce(p->'invoices', '[]')) r where nullif(trim(r->>'vendor_name'), '') is not null group by 1) x)
  );
end;
$$;
revoke execute on function public.wwd_preview(jsonb) from public, anon;
grant execute on function public.wwd_preview(jsonb) to authenticated, service_role;

-- One invoice row from a file, merged into what is on file (fills blanks, never erases). True when new.
create or replace function public.wwd_upsert_invoice(v_org uuid, r jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_seq      text := ltrim(trim(r->>'seq'), '0');
  v_date_seq text;
  v_amt      numeric;
  v_kind     text;
  v_new      boolean;
begin
  if coalesce(v_seq, '') = '' then return false; end if;
  v_amt := nullif(r->>'amount', '')::numeric;
  v_kind := public.wwd_kind(v_seq, v_amt, r->>'kind', r->>'vendor_name');
  -- a scanned page can cut off the first digits ("363752" for 6863752): the one WWD number on file that
  -- ends with it and was paid that amount (less the discount) is the one
  if r->>'source' = 'scan' and not exists (select 1 from public.wwd_invoices where organization_id = v_org and seq = v_seq) then
    select (array_agg(distinct i.seq))[1] into v_date_seq from public.wwd_invoices i
      join public.wwd_payment_lines l on l.invoice_id = i.id
     where i.organization_id = v_org and i.seq like '%' || v_seq and length(v_seq) >= 5 and length(i.seq) > length(v_seq)
       and l.amount in (v_amt, v_amt - coalesce(nullif(r->>'discount', '')::numeric, 0))
    having count(distinct i.seq) = 1;
    v_seq := coalesce(v_date_seq, v_seq);
    v_date_seq := null;
  end if;
  insert into public.wwd_invoices as i (organization_id, seq, kind, wwd_date, wwd_vendor_name, po_number, vendor_invoice_number, vendor_invoice_date, amount, discount,
                                        due_date, terms, freight_amount, sheet_paid_date, sources)
  values (v_org, v_seq, v_kind, nullif(r->>'wwd_date', '')::date, nullif(trim(r->>'vendor_name'), ''), nullif(trim(r->>'po_number'), ''), nullif(trim(r->>'vendor_invoice_number'), ''),
          nullif(r->>'vendor_invoice_date', '')::date, v_amt, nullif(r->>'discount', '')::numeric, nullif(r->>'due_date', '')::date, nullif(trim(r->>'terms'), ''),
          nullif(r->>'freight_amount', '')::numeric, nullif(r->>'sheet_paid_date', '')::date, array_remove(array[nullif(r->>'source', '')], null))
  on conflict (organization_id, seq, kind) do update set
    wwd_date = coalesce(excluded.wwd_date, i.wwd_date), wwd_vendor_name = coalesce(excluded.wwd_vendor_name, i.wwd_vendor_name),
    po_number = coalesce(excluded.po_number, i.po_number), vendor_invoice_number = coalesce(excluded.vendor_invoice_number, i.vendor_invoice_number),
    vendor_invoice_date = coalesce(excluded.vendor_invoice_date, i.vendor_invoice_date), amount = coalesce(excluded.amount, i.amount),
    discount = coalesce(nullif(excluded.discount, 0), i.discount, excluded.discount), due_date = coalesce(excluded.due_date, i.due_date), terms = coalesce(excluded.terms, i.terms),
    freight_amount = coalesce(excluded.freight_amount, i.freight_amount), sheet_paid_date = coalesce(i.sheet_paid_date, excluded.sheet_paid_date),
    sources = (select array_agg(distinct s) from unnest(i.sources || excluded.sources) s), updated_at = now()
  returning (xmax = 0) into v_new;
  return v_new;
end;
$$;
revoke execute on function public.wwd_upsert_invoice(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.wwd_upsert_invoice(uuid, jsonb) to service_role;

create or replace function public.wwd_import(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid := public.current_user_org();
  r      jsonb;
  v_seq  text;
  v_amt  numeric;
  v_kind text;
  v_date date;
  v_pay  uuid;
  v_inv  uuid;
  v_new  boolean;
  n_inv  integer := 0;
  n_pay  integer := 0;
  n_line integer := 0;
  n_paid integer;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers import WWD payments' using errcode = '42501'; end if;

  for r in select * from jsonb_array_elements(coalesce(p->'payments', '[]')) loop
    insert into public.wwd_payments (organization_id, ref, pay_date, total) values (v_org, trim(r->>'ref'), (r->>'pay_date')::date, nullif(r->>'total', '')::numeric)
    on conflict (organization_id, ref, pay_date) do update set total = coalesce(excluded.total, wwd_payments.total)
    returning (xmax = 0) into v_new;
    if v_new then n_pay := n_pay + 1; end if;
  end loop;

  -- files first, then the payment lines, then scans (a scan's cut-off numbers are found through the lines)
  for r in select * from jsonb_array_elements(coalesce(p->'invoices', '[]')) x where x->>'source' is distinct from 'scan' loop
    if public.wwd_upsert_invoice(v_org, r) then n_inv := n_inv + 1; end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p->'lines', '[]')) loop
    v_seq := ltrim(trim(r->>'seq'), '0');
    v_amt := nullif(r->>'amount', '')::numeric;
    v_date := nullif(r->>'wwd_date', '')::date;
    continue when coalesce(v_seq, '') = '' or coalesce(v_amt, 0) = 0;
    select id into v_pay from public.wwd_payments where organization_id = v_org and ref = trim(r->>'ref') and pay_date = (r->>'pay_date')::date;
    continue when v_pay is null;
    v_kind := case
      when v_amt < 0 then 'credit'
      when exists (select 1 from public.wwd_invoices where organization_id = v_org and seq = v_seq and kind = 'fee') then 'fee'
      when exists (select 1 from public.wwd_invoices where organization_id = v_org and seq = v_seq and kind = 'debit' and wwd_date = v_date)
           and not exists (select 1 from public.wwd_invoices where organization_id = v_org and seq = v_seq and kind = 'invoice' and wwd_date = v_date) then 'debit'
      when exists (select 1 from public.wwd_invoices where organization_id = v_org and seq = v_seq and kind = 'invoice') then 'invoice'
      else public.wwd_kind(v_seq, v_amt, null, null) end;
    insert into public.wwd_invoices as i (organization_id, seq, kind, wwd_date, sources) values (v_org, v_seq, v_kind, v_date, array['history'])
    on conflict (organization_id, seq, kind) do update set wwd_date = coalesce(i.wwd_date, excluded.wwd_date),
      sources = case when 'history' = any (i.sources) then i.sources else i.sources || array['history'] end
    returning id, (xmax = 0) into v_inv, v_new;
    if v_new then n_inv := n_inv + 1; end if;
    insert into public.wwd_payment_lines (payment_id, invoice_id, amount) values (v_pay, v_inv, v_amt) on conflict do nothing;
    if found then n_line := n_line + 1; end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p->'invoices', '[]')) x where x->>'source' = 'scan' loop
    if public.wwd_upsert_invoice(v_org, r) then n_inv := n_inv + 1; end if;
  end loop;

  n_paid := public.wwd_relink(v_org);
  insert into public.activity_log (organization_id, entity_type, action, actor_id, details)
  values (v_org, 'wwd_payment', 'import', auth.uid(), jsonb_build_object('invoices_new', n_inv, 'payments_new', n_pay, 'lines_new', n_line, 'orders_paid', n_paid));
  return jsonb_build_object('invoices_new', n_inv, 'payments_new', n_pay, 'lines_new', n_line, 'orders_paid', n_paid,
    'no_vendor', (select count(*) from public.wwd_invoices where organization_id = v_org and vendor_id is null),
    'linked_orders', (select count(distinct order_id) from public.wwd_invoices where organization_id = v_org and order_id is not null));
end;
$$;
revoke execute on function public.wwd_import(jsonb) from public, anon;
grant execute on function public.wwd_import(jsonb) to authenticated, service_role;

-- A person names the vendor behind a WWD spelling: the spelling becomes an alias (next import matches it),
-- and every invoice with that spelling moves to the vendor.
create or replace function public.wwd_assign_name(p_name text, p_vendor uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.current_user_org();
  n     integer;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers sort WWD invoices' using errcode = '42501'; end if;
  if not exists (select 1 from public.vendors where id = p_vendor and organization_id = v_org) then raise exception 'Vendor not found'; end if;
  update public.vendors set aliases = array_append(aliases, trim(p_name))
   where id = p_vendor and upper(name) <> upper(trim(p_name)) and not exists (select 1 from unnest(aliases) a where upper(a) = upper(trim(p_name)));
  update public.wwd_invoices set vendor_id = p_vendor, vendor_set_by = 'person', updated_at = now()
   where organization_id = v_org and upper(trim(wwd_vendor_name)) = upper(trim(p_name));
  get diagnostics n = row_count;
  perform public.wwd_relink(v_org);
  return n;
end;
$$;
revoke execute on function public.wwd_assign_name(text, uuid) from public, anon;
grant execute on function public.wwd_assign_name(text, uuid) to authenticated, service_role;

-- One invoice by hand: its vendor, its order (or no order).
create or replace function public.wwd_update_invoice(p_id uuid, p_vendor uuid default null, p_order uuid default null, p_unlink_order boolean default false)
returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.current_user_org();
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers sort WWD invoices' using errcode = '42501'; end if;
  if not exists (select 1 from public.wwd_invoices where id = p_id and organization_id = v_org) then raise exception 'WWD invoice not found'; end if;
  if p_vendor is not null then
    update public.wwd_invoices set vendor_id = p_vendor, vendor_set_by = 'person', order_id = case when vendor_id is distinct from p_vendor then null else order_id end, updated_at = now() where id = p_id;
  end if;
  if p_order is not null then
    update public.wwd_invoices i set order_id = p_order, order_set_by = 'person', vendor_id = coalesce(i.vendor_id, o.vendor_id), updated_at = now()
      from public.orders o where o.id = p_order and o.organization_id = v_org and i.id = p_id;
  elsif p_unlink_order then
    update public.wwd_invoices set order_id = null, order_set_by = 'person', updated_at = now() where id = p_id;
  end if;
  perform public.wwd_relink(v_org);
end;
$$;
revoke execute on function public.wwd_update_invoice(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.wwd_update_invoice(uuid, uuid, uuid, boolean) to authenticated, service_role;
