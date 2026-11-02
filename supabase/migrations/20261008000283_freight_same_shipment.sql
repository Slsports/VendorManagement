-- 0283 — The packages of one shipment go to the same order (Dana, Nov 2 back-check): a bill read again can list a shipment
-- package by package; a line with the same shipper and ship date as a confirmed line on the same bill (one order among
-- them) is that shipment, so it is confirmed to the same order. Also: a printed reference like "INV.# 32962" matches order
-- 32962 (the key drops a leading INV / PO / # label).
set local lock_timeout = '5s';

create or replace function public.freight_ref_key(p text) returns text
language sql immutable set search_path = '' as $$
  select lower(regexp_replace(regexp_replace(coalesce(p, ''), '^\s*(po|inv|invoice|ref|order)\.?\s*(#|no\.?|number)?\s*:?\s*', '', 'i'), '[^A-Za-z0-9]', '', 'g'))
$$;

create or replace function public.freight_bill_siblings(p_bill uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.freight_bill_lines l set order_id = s.order_id, vendor_id = s.vendor_id, confirmed = true, confirmed_at = now()
    from (select distinct on (lower(shipper_name), ship_date) lower(shipper_name) sn, ship_date, order_id, vendor_id
            from public.freight_bill_lines x
           where x.bill_id = p_bill and x.confirmed and x.order_id is not null and x.ship_date is not null
             and (select count(distinct y.order_id) from public.freight_bill_lines y where y.bill_id = p_bill and y.confirmed
                   and lower(y.shipper_name) = lower(x.shipper_name) and y.ship_date = x.ship_date) = 1) s
   where l.bill_id = p_bill and not l.confirmed and lower(l.shipper_name) = s.sn and l.ship_date = s.ship_date;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.freight_bill_siblings(uuid) from public, anon, authenticated;
grant execute on function public.freight_bill_siblings(uuid) to service_role;

-- freight_bill_loaded (0282) ends by placing the fee and setting the status; run the sibling step just before, from a
-- wrapper trigger-free path: the loaded function calls it.
do $$
declare src text;
begin
  select pg_get_functiondef('public.freight_bill_loaded(uuid)'::regprocedure) into src;
  if position('freight_bill_siblings' in src) = 0 then
    src := replace(src, '  perform public.freight_place_fee(p_bill);', '  perform public.freight_bill_siblings(p_bill);' || chr(10) || '  perform public.freight_place_fee(p_bill);');
    execute src;
  end if;
end $$;

-- Back-check: every open bill.
do $$
declare b record;
begin
  for b in select id from public.freight_bills where status = 'to_match' loop
    if public.freight_bill_siblings(b.id) > 0 then
      perform public.freight_place_fee(b.id);
      perform public.freight_order_cost(x.order_id) from (select distinct order_id from public.freight_bill_lines where bill_id = b.id and confirmed and order_id is not null) x;
      update public.freight_bills set status = 'done' where id = b.id and not exists (select 1 from public.freight_bill_lines where bill_id = b.id and not confirmed);
    end if;
  end loop;
end $$;
