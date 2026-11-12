-- 0357: a vendor with an open order and no email is listed until ticked No routing letter; retail stores and vendors
-- billed through Faire by default never are.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; a uuid; b uuid; c uuid;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  insert into public.vendors (organization_id, name) values (v_org, 'TEST NRL A 0357') returning id into a;
  insert into public.vendors (organization_id, name, is_retail_store) values (v_org, 'TEST NRL B 0357', true) returning id into b;
  insert into public.vendors (organization_id, name) values (v_org, 'TEST NRL C 0357') returning id into c;
  insert into public.vendor_billing_routes (vendor_id, route, is_default) values (c, 'faire', true);
  insert into public.orders (organization_id, vendor_id, status, source) values (v_org, a, 'open', 'manual'), (v_org, b, 'open', 'manual'), (v_org, c, 'open', 'manual');
  if not exists (select 1 from public.routing_letter_missing(v_org, 'open_orders') where vendor_id = a) then raise exception 'A not listed'; end if;
  if exists (select 1 from public.routing_letter_missing(v_org, 'open_orders') where vendor_id in (b, c)) then raise exception 'retail or Faire listed'; end if;
  update public.vendors set no_routing_letter = true where id = a;
  if exists (select 1 from public.routing_letter_missing(v_org, 'open_orders') where vendor_id = a) then raise exception 'ticked vendor still listed'; end if;
  perform set_config('request.jwt.claims', '', true);
  raise exception 'ok-rollback';
exception when others then
  if sqlerrm <> 'ok-rollback' then raise; end if;
end $$;
