-- 0356: exactly 10% freight is "10% or less" (no quote needed); just over is listed.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v_vendor uuid; v_order uuid;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  insert into public.vendors (organization_id, name) values (v_org, 'TEST 10PCT 0356') returning id into v_vendor;
  insert into public.orders (organization_id, vendor_id, status, po_number, source, free_shipping, order_date, est_cost, freight_cost)
    values (v_org, v_vendor, 'shipped', 'T356', 'manual', false, '2026-11-01', 1000, 100) returning id into v_order;
  if exists (select 1 from public.freight_unapproved_shipments(v_org) where order_id = v_order) then raise exception 'exactly 10%% listed'; end if;
  update public.orders set freight_cost = 100.01 where id = v_order;
  if not exists (select 1 from public.freight_unapproved_shipments(v_org) where order_id = v_order) then raise exception 'over 10%% not listed'; end if;
  perform set_config('request.jwt.claims', '', true);
  raise exception 'ok-rollback';
exception when others then
  if sqlerrm <> 'ok-rollback' then raise; end if;
end $$;
