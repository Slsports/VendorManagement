-- 0282 — Freight shipments find their order by the PO printed on the bill and by the ship date (Dana, Nov 2): "the name of
-- the triple t order in vms clearly states the date is 2/4/26. that can be a clue for vms when the date is in the
-- filename" … "go on both. Also, Paricon: The partnership invoice clearly says the PO, which includes the date 1-19-26 …
-- Why did VMS not figure that out??"
-- Why: the reader kept shipper, date, tracking and charges but not the "Ref #" / PO lines, and freight_bill_loaded
-- suggested the vendor's newest order not yet received, whatever the ship date (a 2023 Triple T shipment got a 2026 order,
-- Becker's Nov 2025 shipments this year's order). Now, for each shipment not yet confirmed:
--   1. a PO printed on the bill that is one of our orders' POs → that order, confirmed;
--   2. its tracking number in a vendor's shipping email tied to an order → that order, confirmed;
--   3. otherwise a suggestion only: the vendor's order placed closest before the ship date (the order date, else a date
--      in the PO like 1-19-26 or 020426, else when VMS made it), never one placed after the shipment, never a cancelled one.
-- A bill whose shipments are all confirmed is done. Back-check: the open bills are read again (freight-read) to pick up
-- their references; the 2023 Triple T shipment (before any Triple T order in VMS) is closed with no order.
set local lock_timeout = '5s';

alter table public.freight_bill_lines add column if not exists po_refs text[] not null default '{}';
comment on column public.freight_bill_lines.po_refs is 'PO and reference numbers printed for the shipment (Ref # 1, Ref # 2, PO), as read from the bill.';

-- A date written in a PO or name: 1-19-26, 2/4/26, 11.20.2025, or six digits MMDDYY (020426). Null when there is none.
create or replace function public.po_date(p text) returns date
language plpgsql immutable set search_path = '' as $$
declare m text[]; y integer;
begin
  if p is null then return null; end if;
  for m in select regexp_matches(p, '(?<!\d)(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)', 'g') loop
    y := m[3]::int; if y < 100 then y := 2000 + y; end if;
    begin return make_date(y, m[1]::int, m[2]::int); exception when others then null; end;
  end loop;
  for m in select regexp_matches(p, '(?<!\d)(0[1-9]|1[0-2])([0-2]\d|3[01])(2\d)(?!\d)', 'g') loop
    begin return make_date(2000 + m[3]::int, m[1]::int, m[2]::int); exception when others then null; end;
  end loop;
  return null;
end;
$$;
grant execute on function public.po_date(text) to authenticated, service_role;

-- When an order was placed, for matching freight: its order date, else a date in its PO, else when VMS made it.
create or replace function public.order_placed_on(o public.orders) returns date
language sql stable set search_path = public as $$
  select coalesce(o.order_date, public.po_date(o.po_number), o.created_at::date)
$$;
grant execute on function public.order_placed_on(public.orders) to authenticated, service_role;

create or replace function public.freight_ref_key(p text) returns text
language sql immutable set search_path = '' as $$ select lower(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) $$;

create or replace function public.freight_bill_loaded(p_bill uuid)
returns void language plpgsql security definer set search_path = public as $$
declare l record; v_order uuid; v_vendor uuid; v_n integer; v_trk text;
begin
  for l in select * from public.freight_bill_lines where bill_id = p_bill and not confirmed loop
    v_order := null; v_vendor := coalesce(l.vendor_id, l.suggested_vendor_id);
    -- 1. a PO printed on the bill
    select count(distinct o.id), min(o.id::text)::uuid into v_n, v_order
      from public.orders o
     where o.organization_id = l.organization_id and o.status <> 'cancelled' and length(public.freight_ref_key(o.po_number)) >= 5
       and exists (select 1 from unnest(l.po_refs) r where public.freight_ref_key(r) = public.freight_ref_key(o.po_number))
       and (v_vendor is null or o.vendor_id = v_vendor
            or not exists (select 1 from public.orders o2 where o2.organization_id = l.organization_id and o2.vendor_id = v_vendor
                             and exists (select 1 from unnest(l.po_refs) r where public.freight_ref_key(r) = public.freight_ref_key(o2.po_number))));
    if v_n = 1 then
      update public.freight_bill_lines set order_id = v_order, vendor_id = (select vendor_id from public.orders where id = v_order),
             confirmed = true, confirmed_at = now() where id = l.id;
      continue;
    end if;
    -- 2. its tracking number in a shipping email tied to an order
    v_trk := lower(regexp_replace(coalesce(l.tracking[1], ''), '[^A-Za-z0-9]', '', 'g'));
    if length(v_trk) >= 8 then
      select count(distinct e.order_id), min(e.order_id::text)::uuid into v_n, v_order
        from public.emails e
       where e.organization_id = l.organization_id and e.order_id is not null and e.search @@ to_tsquery('simple', v_trk);
      if v_n = 1 and (v_vendor is null or exists (select 1 from public.orders o where o.id = v_order and o.vendor_id = v_vendor)
                      or not exists (select 1 from public.orders o where o.vendor_id = v_vendor)) then
        update public.freight_bill_lines set order_id = v_order, vendor_id = (select vendor_id from public.orders where id = v_order),
               confirmed = true, confirmed_at = now() where id = l.id;
        continue;
      end if;
    end if;
    -- 3. a suggestion: the vendor's order placed closest before the ship date
    if v_vendor is not null and l.order_id is null then
      select o.id into v_order
        from public.orders o
       where o.vendor_id = v_vendor and o.status <> 'cancelled'
         and (l.ship_date is null or public.order_placed_on(o) between l.ship_date - 365 and l.ship_date + 3)
       order by case when l.ship_date is null then (o.date_received is null)::int else 0 end desc, public.order_placed_on(o) desc
       limit 1;
    end if;
    update public.freight_bill_lines set vendor_id = v_vendor, order_id = coalesce(l.order_id, v_order) where id = l.id;
  end loop;
  perform public.freight_place_fee(p_bill);
  perform public.freight_order_cost(x.order_id) from (select distinct order_id from public.freight_bill_lines where bill_id = p_bill and confirmed and order_id is not null) x;
  update public.freight_bills set
         status = case when not exists (select 1 from public.freight_bill_lines where bill_id = p_bill) then 'failed'
                       when not exists (select 1 from public.freight_bill_lines where bill_id = p_bill and not confirmed) then 'done'
                       else 'to_match' end,
         read_at = now()
   where id = p_bill;
end;
$$;
revoke execute on function public.freight_bill_loaded(uuid) from public, anon, authenticated;
grant execute on function public.freight_bill_loaded(uuid) to service_role;

-- Back-check (data): the 2023 Triple T shipment on PS00548954 was before any Triple T order in VMS (Dana, Nov 2): closed with no order.
update public.freight_bill_lines l set order_id = null, confirmed = true, confirmed_at = now()
  from public.freight_bills b
 where b.id = l.bill_id and b.invoice_number = 'PS00548954' and l.shipper_name ilike 'triple t%' and not l.confirmed;
update public.freight_bills b set status = 'done'
 where b.invoice_number = 'PS00548954' and b.status = 'to_match'
   and not exists (select 1 from public.freight_bill_lines l where l.bill_id = b.id and not l.confirmed);
