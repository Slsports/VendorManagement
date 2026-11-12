-- A draft Sno-Park order is removed with its VMS order; a sent one is not.
begin;
select '00000000-0000-0000-0000-000000000001'::uuid as org \gset
insert into public.vendors (organization_id, name) values (:'org', 'CA SNO-PARK') returning id as csp \gset
insert into public.snopark_seasons (organization_id, vendor_id, label, first_report_month, season_end, final_due) values (:'org', :'csp', '2026-2027', '2026-11-01', '2027-05-30', '2027-06-20') returning id as season \gset
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select set_config('t.season', :'season', false);
do $$ declare a uuid; b uuid; vo uuid; begin
  a := public.snopark_order_start(current_setting('t.season')::uuid, 5, 0, '2026-11-12', null);
  b := public.snopark_order_start(current_setting('t.season')::uuid, 5, 0, '2026-11-12', null);
  update public.snopark_orders set status = 'sent' where id = b;
  select order_id into vo from public.snopark_orders where id = a;
  perform public.snopark_order_remove(a);
  if exists (select 1 from public.snopark_orders where id = a) then raise exception 'not removed'; end if;
  if exists (select 1 from public.orders where id = vo) then raise exception 'VMS order kept'; end if;
  begin
    perform public.snopark_order_remove(b);
    raise exception 'a sent order was removed';
  exception when invalid_parameter_value then null; end;
end $$;
rollback;
