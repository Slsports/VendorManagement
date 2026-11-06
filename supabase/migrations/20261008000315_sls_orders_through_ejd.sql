-- 0315 — SLS orders bought through a hardware-store supplier (Dana, Nov 6). "Sometimes we do buy things for the sls from EJD …
-- We buy most of our Paricon inventory from Paricon direct but their free freight threshold is $25,000 … With Emery Jensen, we
-- have an order that comes in for the hardware store almost every week and they charge a flat $65 per truckload so it is
-- essentially free for us to get some Paricon stuff from EJD." And: "I also want it to show under EJD as an SLS Order. During the
-- summer we also order brickettes and other bbq stuff, and some camping stuff."
--   • orders.brand_vendor_id: the SLS vendor whose goods an order from a hardware supplier is for (Paricon sleds from EJD). The
--     order stays under EJD; it also shows on that vendor's page as bought through EJD. No foreign key on purpose: a second
--     orders → vendors key would make every vendors(…) embed from orders ambiguous; a merge moves it (trigger below).
--   • An order from a hardware supplier (is_slh_vendor) is an SLS order when its PO names one of our SLS vendors (EJDPARICON11526
--     → PARICON) or says SLS (BBQSLS…). Its store becomes SLS when it was SLH only or blank; an order already set for SLS or for
--     several stores is left as it is.
--   • EJD's freight: flat $65 per truckload, on the weekly hardware truck.
set local lock_timeout = '5s';

alter table public.orders add column if not exists brand_vendor_id uuid;
comment on column public.orders.brand_vendor_id is 'The SLS vendor whose goods this order from a hardware supplier is for (Paricon through EJD, Dana Nov 6). No FK on purpose.';
create index if not exists orders_brand_vendor on public.orders (brand_vendor_id) where brand_vendor_id is not null;

/** The one SLS vendor a hardware supplier's PO names: the PO minus its date ends with that vendor's name or other name. */
create or replace function public.order_brand_from_po(p_vendor uuid, p_po text) returns uuid
language sql stable security definer set search_path = public as $$
  with o as (select v.organization_id as org from public.vendors v where v.id = p_vendor and v.is_slh_vendor),
       k as (select public.payee_key(regexp_replace(coalesce(p_po, ''), '[0-9][0-9 ./_#-]*[A-Za-z]?$', '')) as pk),
       hits as (
         select distinct v.id from public.vendors v, o, k, unnest(array_append(v.aliases, v.name)) nm
          where v.organization_id = o.org and v.merged_into_id is null and v.id <> p_vendor and not v.is_slh_vendor
            and length(public.payee_key(nm)) >= 5 and length(k.pk) >= 5
            and right(k.pk, length(public.payee_key(nm))) = public.payee_key(nm)
            and length(k.pk) - length(public.payee_key(nm)) <= 6)
  select case when (select count(*) from hits) = 1 then (select id from hits) end
$$;
revoke execute on function public.order_brand_from_po(uuid, text) from public, anon;
grant execute on function public.order_brand_from_po(uuid, text) to authenticated, service_role;

create or replace function public.orders_sls_through_supplier() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_slh boolean; v_brand uuid;
begin
  select is_slh_vendor into v_slh from public.vendors where id = new.vendor_id;
  if not coalesce(v_slh, false) then
    if tg_op = 'UPDATE' and new.vendor_id is distinct from old.vendor_id then new.brand_vendor_id := null; end if;
    return new;
  end if;
  v_brand := public.order_brand_from_po(new.vendor_id, new.po_number);
  if tg_op = 'INSERT' or new.po_number is distinct from old.po_number or new.vendor_id is distinct from old.vendor_id then
    new.brand_vendor_id := coalesce(v_brand, case when tg_op = 'INSERT' then new.brand_vendor_id end);
  end if;
  if (v_brand is not null or upper(coalesce(new.po_number, '')) like '%SLS%')
     and (coalesce(cardinality(new.store_codes), 0) = 0 or new.store_codes = array['SLH']::text[]) then
    new.store_codes := array['SLS']::text[];
  end if;
  return new;
end;
$$;
revoke execute on function public.orders_sls_through_supplier() from public, anon, authenticated;
drop trigger if exists orders_sls_through_supplier on public.orders;
create trigger orders_sls_through_supplier before insert or update of po_number, vendor_id on public.orders
  for each row execute function public.orders_sls_through_supplier();

-- a merged vendor's orders bought through a supplier follow it
create or replace function public.vendors_merge_brand_orders() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.merged_into_id is not null and old.merged_into_id is null then
    update public.orders set brand_vendor_id = new.merged_into_id where brand_vendor_id = new.id;
  end if;
  return null;
end;
$$;
revoke execute on function public.vendors_merge_brand_orders() from public, anon, authenticated;
drop trigger if exists vendors_merge_brand_orders on public.vendors;
create trigger vendors_merge_brand_orders after update of merged_into_id on public.vendors
  for each row execute function public.vendors_merge_brand_orders();

-- EJD's freight (Dana, Nov 6)
update public.vendors set freight_program = 'Flat $65 per truckload; ships on the weekly hardware truck', updated_at = now()
 where name = 'EMERY JENSEN DIST' and merged_into_id is null;

-- Back-check: every order from a hardware supplier gets the SLS vendor its PO names. Only the Paricon sleds order Dana named moves
-- to SLS here; any other SLH-only order that matches is listed for Dana instead of changed (raise notice).
do $$
declare r record; n_brand int := 0;
begin
  update public.orders o set brand_vendor_id = public.order_brand_from_po(o.vendor_id, o.po_number)
   where exists (select 1 from public.vendors v where v.id = o.vendor_id and v.is_slh_vendor)
     and o.brand_vendor_id is distinct from public.order_brand_from_po(o.vendor_id, o.po_number)
     and public.order_brand_from_po(o.vendor_id, o.po_number) is not null;
  get diagnostics n_brand = row_count;
  update public.orders set store_codes = array['SLS']::text[] where po_number = 'EJDPARICON11526' and store_codes = array['SLH']::text[];
  raise notice 'orders tied to an SLS vendor: %', n_brand;
  for r in select o.po_number, o.store_codes, v.name from public.orders o join public.vendors v on v.id = o.brand_vendor_id
            where o.store_codes = array['SLH']::text[] loop
    raise notice 'still SLH, ask Dana: % (for %)', r.po_number, r.name;
  end loop;
end $$;
