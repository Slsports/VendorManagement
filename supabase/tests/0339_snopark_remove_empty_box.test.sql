-- An empty box can be removed; one with a sheet or books cannot.
begin;
select '00000000-0000-0000-0000-000000000001'::uuid as org \gset
insert into public.vendors (organization_id, name) values (:'org', 'CA SNO-PARK') returning id as csp \gset
insert into public.snopark_seasons (organization_id, vendor_id, label, first_report_month, season_end, final_due) values (:'org', :'csp', '2026-2027', '2026-11-01', '2027-05-30', '2027-06-20') returning id as season \gset
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select set_config('t.season', :'season', false);
do $$ declare a uuid; b uuid; begin
  a := public.snopark_shipment_start(current_setting('t.season')::uuid, '2026-11-20', null);
  b := public.snopark_shipment_start(current_setting('t.season')::uuid, '2026-11-20', null);
  perform public.snopark_shipment_sheet(b, '{"rows":[{"kind":"day","from":1,"to":25}]}'::jsonb, null, true);
  perform public.snopark_shipment_books(b, '[{"kind":"day","book_number":"DB 1","first_permit":1,"last_permit":25}]'::jsonb);
  perform public.snopark_shipment_remove(a);
  if exists (select 1 from public.snopark_shipments where id = a) then raise exception 'empty box not removed'; end if;
  begin
    perform public.snopark_shipment_remove(b);
    raise exception 'a box with books was removed';
  exception when invalid_parameter_value then null; end;
end $$;
rollback;
