-- 0301 — WWD's own pallet shipments go under WWD (Dana, Nov 3: "Put the unknown pallets from WWD also under WWD").
--   A freight line shipped by World Wide Distributors (WWD's warehouse) that VMS could not tie to an order goes to the
--   WORLDWIDE vendor, confirmed, so the bill is done and shows on WWD's page. It stays on its freight company (XPO) too.
--   A person can still split it across orders later (Shared freight bills).
set local lock_timeout = '5s';

create or replace function public.freight_wwd_pallets(p_bill uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  b public.freight_bills%rowtype;
  v uuid;
  n integer;
begin
  select * into b from public.freight_bills where id = p_bill;
  if b.id is null then return 0; end if;
  v := public.wwd_self_vendor(b.organization_id);
  if v is null then return 0; end if;
  update public.freight_bill_lines set vendor_id = v, confirmed = true, confirmed_at = now()
   where bill_id = p_bill and not confirmed and order_id is null and vendor_id is null
     and shipper_name ~* 'world\s*wide\s*distrib';
  get diagnostics n = row_count;
  if n > 0 and not exists (select 1 from public.freight_bill_lines where bill_id = p_bill and not confirmed) then
    update public.freight_bills set status = 'done' where id = p_bill and status = 'to_match';
  end if;
  return n;
end;
$$;
revoke execute on function public.freight_wwd_pallets(uuid) from public, anon, authenticated;
grant execute on function public.freight_wwd_pallets(uuid) to service_role;

-- after each read of a bill (freight_bill_loaded sets read_at last)
create or replace function public.freight_bills_wwd_pallets() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.freight_wwd_pallets(new.id);
  return null;
end;
$$;
revoke execute on function public.freight_bills_wwd_pallets() from public, anon, authenticated;
drop trigger if exists freight_bills_wwd_pallets on public.freight_bills;
create trigger freight_bills_wwd_pallets after update of read_at on public.freight_bills for each row execute function public.freight_bills_wwd_pallets();

-- back-fix: the bills on file
select public.freight_wwd_pallets(b.id) from public.freight_bills b
 where exists (select 1 from public.freight_bill_lines l where l.bill_id = b.id and not l.confirmed and l.order_id is null and l.vendor_id is null
                 and l.shipper_name ~* 'world\s*wide\s*distrib');
