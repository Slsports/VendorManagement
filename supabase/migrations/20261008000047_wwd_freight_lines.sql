-- 0068 — WWD lines for a freight company (Dana, Oct 9: "there's a payment in here for XPO and it doesn't let me
-- pick a shipper"). A WWD name can be a freight company: its lines are filed to the company (carrier_id) and
-- also to the vendor whose goods it carried, so they count in that vendor's freight. The vendor comes from the
-- XPO delivery receipt with the same PRO number when there is one, else a person picks it per line. Freight
-- companies learn WWD spellings as aliases, like vendors; "XPO Logistics Freight, Inc" starts with "XPO" and
-- files itself.
alter table public.carriers add column if not exists aliases text[] not null default '{}';
alter table public.wwd_invoices add column if not exists carrier_id uuid references public.carriers(id) on delete set null;
create index if not exists wwd_invoices_carrier_idx on public.wwd_invoices (carrier_id, wwd_date desc);

create or replace function public.wwd_carrier_for(p_org uuid, p_name text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  k   text := public.payee_key(p_name);
  w   text := public.wwd_words(p_name) || ' ';
  ids uuid[];
begin
  if p_name is null or length(k) < 2 then return null; end if;
  select array_agg(distinct c.id) into ids from public.carriers c
   where c.organization_id = p_org and c.is_active
     and (public.payee_key(c.name) = k or exists (select 1 from unnest(c.aliases) a where public.payee_key(a) = k)
          or exists (select 1 from unnest(array[c.name] || c.aliases) n where length(public.wwd_words(n)) >= 3 and w like public.wwd_words(n) || ' %'));
  return case when cardinality(ids) = 1 then ids[1] end;
end;
$$;

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
  -- a freight company's name (XPO): the line is freight, filed to the company; its vendor comes from the
  -- delivery receipt with the same PRO number (the EdenRed "invoice number" on an XPO line is its PRO)
  update public.wwd_invoices i set carrier_id = m.cid, updated_at = now()
    from (select x.nm, public.wwd_carrier_for(p_org, x.nm) as cid
            from (select distinct wwd_vendor_name as nm from public.wwd_invoices
                   where organization_id = p_org and carrier_id is null and vendor_id is null and wwd_vendor_name is not null) x) m
   where i.organization_id = p_org and i.carrier_id is null and i.vendor_id is null and i.wwd_vendor_name = m.nm and m.cid is not null;
  update public.wwd_invoices i set vendor_id = d.vendor_id, vendor_set_by = 'auto', order_id = coalesce(i.order_id, d.order_id),
         order_set_by = case when i.order_id is null and d.order_id is not null then 'auto' else i.order_set_by end, updated_at = now()
    from public.delivery_receipts d
   where i.organization_id = p_org and i.carrier_id is not null and i.vendor_id is null and d.organization_id = p_org
     and d.carrier_id = i.carrier_id and d.vendor_id is not null
     and length(regexp_replace(coalesce(i.vendor_invoice_number, ''), '\D', '', 'g')) >= 6
     and regexp_replace(d.pro_number, '\D', '', 'g') = regexp_replace(i.vendor_invoice_number, '\D', '', 'g');
  -- our PO names exactly one order: that order's vendor
  update public.wwd_invoices i set vendor_id = o.vendor_id, vendor_set_by = 'auto', updated_at = now()
    from (select i2.id, (select (array_agg(o.vendor_id))[1] from public.orders o
                          where o.organization_id = p_org and public.po_key(o.po_number) = public.po_key(i2.po_number) having count(distinct o.vendor_id) = 1) as vendor_id
            from public.wwd_invoices i2 where i2.organization_id = p_org and i2.vendor_id is null and i2.vendor_set_by is distinct from 'person' and public.po_key(i2.po_number) is not null) o
   where o.id = i.id and o.vendor_id is not null;
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
                          where o.vendor_id = i2.vendor_id and o.status <> 'cancelled' and i2.amount in (o.final_cost, o.est_cost)
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
   where c.order_id = o.id and o.freight_allowance_offered and o.freight_allowance_received is null and c.d is not null;
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

-- A person names the freight company behind a WWD spelling.
create or replace function public.wwd_assign_name_carrier(p_name text, p_carrier uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.current_user_org();
  n     integer;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers sort WWD invoices' using errcode = '42501'; end if;
  if not exists (select 1 from public.carriers where id = p_carrier and organization_id = v_org) then raise exception 'Freight company not found'; end if;
  update public.carriers set aliases = array_append(aliases, trim(p_name))
   where id = p_carrier and upper(name) <> upper(trim(p_name)) and not exists (select 1 from unnest(aliases) a where upper(a) = upper(trim(p_name)));
  update public.wwd_invoices set carrier_id = p_carrier, updated_at = now()
   where organization_id = v_org and upper(trim(wwd_vendor_name)) = upper(trim(p_name));
  get diagnostics n = row_count;
  perform public.wwd_relink(v_org);
  return n;
end;
$$;
revoke execute on function public.wwd_assign_name_carrier(text, uuid) from public, anon;
grant execute on function public.wwd_assign_name_carrier(text, uuid) to authenticated, service_role;

-- The WWD payments list (Payments page): one row per payment with how many vendors it paid, the discounts
-- taken and lines with no vendor yet; payments still waiting for their PB number (only on Dana's sheet) are
-- one row per sheet date. Reads under the caller's own rights.
create or replace function public.wwd_payment_list()
returns table (payment_id uuid, ref text, pay_date date, total numeric, lines integer, vendors integer, discounts numeric, unknown integer, pending boolean)
language sql stable set search_path = public as $$
  with pl as (
    select p.id, p.ref, p.pay_date, p.total, l.invoice_id, l.amount, i.vendor_id, i.carrier_id, i.discount, i.amount as inv_amount
      from public.wwd_payments p
      left join public.wwd_payment_lines l on l.payment_id = p.id
      left join public.wwd_invoices i on i.id = l.invoice_id
     where public.user_in_org(p.organization_id)
  ), per_inv as (
    select id, invoice_id, max(vendor_id::text) as vendor_id, max(carrier_id::text) as carrier_id, sum(amount) as paid, max(discount) as discount, max(inv_amount) as inv_amount
      from pl where invoice_id is not null group by id, invoice_id
  )
  select p.id, p.ref, p.pay_date, p.total,
         (select count(*) from pl where pl.id = p.id and pl.invoice_id is not null)::integer,
         (select count(distinct coalesce(vendor_id, carrier_id)) from per_inv x where x.id = p.id)::integer,
         coalesce((select sum(x.discount) from per_inv x where x.id = p.id and x.discount is not null and x.inv_amount > 0 and abs(x.inv_amount - x.discount - x.paid) < 0.02), 0),
         (select count(*) from per_inv x where x.id = p.id and x.vendor_id is null and x.carrier_id is null)::integer,
         false
    from public.wwd_payments p where public.user_in_org(p.organization_id)
  union all
  select null, null, i.sheet_paid_date, sum(i.amount - coalesce(i.discount, 0)), count(*)::integer, count(distinct coalesce(i.vendor_id, i.carrier_id))::integer,
         coalesce(sum(i.discount), 0), count(*) filter (where i.vendor_id is null and i.carrier_id is null)::integer, true
    from public.wwd_invoices i
   where public.user_in_org(i.organization_id) and i.paid_date is null and i.sheet_paid_date is not null
   group by i.sheet_paid_date
$$;
revoke execute on function public.wwd_payment_list() from public, anon;
grant execute on function public.wwd_payment_list() to authenticated, service_role;
