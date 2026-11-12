-- A no-freight vendor: its orders carry free freight from the start, a shipment request for it is skipped at birth, and
-- it never shows as missing a routing letter.
begin;
select '00000000-0000-0000-0000-000000000001'::uuid as org \gset
insert into public.vendors (organization_id, name, no_freight) values (:'org', 'CA SNO-PARK 0346', true) returning id as v \gset
insert into public.orders (organization_id, vendor_id, status, order_date, source) values (:'org', :'v', 'open', '2026-11-12', 'manual') returning id as o \gset
insert into public.shipment_requests (organization_id, order_id, vendor_id, kind, status) values (:'org', :'o', :'v', 'details', 'ready') returning id as r \gset
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select set_config('t.v', :'v', false);
select set_config('t.o', :'o', false);
select set_config('t.r', :'r', false);
do $$ begin
  if (select freight_terms from public.orders where id = current_setting('t.o')::uuid) <> 'free' then raise exception 'order not free freight'; end if;
  if (select free_shipping from public.orders where id = current_setting('t.o')::uuid) is not true then raise exception 'free_shipping'; end if;
  if (select status from public.shipment_requests where id = current_setting('t.r')::uuid) <> 'skipped' then raise exception 'shipment request not skipped'; end if;
  if exists (select 1 from public.routing_letter_missing('00000000-0000-0000-0000-000000000001', 'open_orders') where vendor_id = current_setting('t.v')::uuid) then raise exception 'asked for a routing letter'; end if;
end $$;
rollback;
