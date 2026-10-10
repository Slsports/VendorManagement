-- 0066 — WWD vendor names, second pass (Oct 9, first load of Dana's files): VMS keeps short brand names
-- ("DAISY", "ATWOOD ROPE", "G PUCCI") where WWD prints the company ("Daisy Outdoor Products", "Atwood Rope
-- Mfg", "G Pucci & Sons Inc"). A vendor whose name or alias the WWD name starts with, word for word, is the
-- one (the longest such name wins; a tie stays for a person). An EdenRed PO that names exactly one order gives
-- that order's vendor.

-- "Daisy Outdoor Products" → "daisy outdoor products": words only, for whole-word prefix checks.
create or replace function public.wwd_words(p text) returns text language sql immutable as $$
  select trim(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', ' ', 'g'))
$$;

create or replace function public.wwd_vendor_for(p_org uuid, p_name text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  k    text := public.payee_key(p_name);
  ids  uuid[];
  part text;
  w    text;
begin
  if p_name is null or length(k) < 2 then return null; end if;
  if p_name ~* '^(worldwide (distributors|buying group)|wwd dues|wwd|dues)\M' then return public.wwd_self_vendor(p_org); end if;
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
  -- the WWD name starts with a vendor's name or alias, word for word (the vendor's own " - WWD" style tags dropped)
  foreach part in array array[p_name] || regexp_split_to_array(p_name, '\s*/\s*') loop
    w := public.wwd_words(part) || ' ';
    continue when length(w) < 5;
    select array_agg(h.id) into ids from (
      select x.id, max(length(x.nw)) as len, max(max(length(x.nw))) over () as top
        from (select v.id, public.wwd_words(regexp_replace(n, '\s+-\s.*$', '')) as nw
                from public.vendors v cross join lateral unnest(array[v.name] || v.aliases) n
               where v.organization_id = p_org and v.is_active) x
       where length(x.nw) >= 4 and w like x.nw || ' %'
       group by x.id) h
     where h.len = h.top;
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
