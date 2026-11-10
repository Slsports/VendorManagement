-- A balanced box marked entered in Lightspeed by hand: done, no LS PO, the order received.
begin;
select '00000000-0000-0000-0000-000000000001'::uuid as org \gset
insert into public.vendors (organization_id, name) values (:'org', 'CA SNO PARK') returning id as csp \gset
insert into public.orders (organization_id, vendor_id, status, order_date, po_number, source) values (:'org', :'csp', 'received', '2026-10-20', 'CASNOPARK102026', 'manual') returning id as ord \gset
insert into public.snopark_seasons (organization_id, vendor_id, label, first_report_month, season_end, final_due) values (:'org', :'csp', '2026-2027', '2026-11-01', '2027-05-30', '2027-06-20') returning id as season \gset
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select set_config('t.season', :'season', false);
select set_config('t.ord', :'ord', false);
do $$ declare sh uuid; begin
  sh := public.snopark_shipment_start(current_setting('t.season')::uuid, '2026-10-28', current_setting('t.ord')::uuid);
  begin
    perform public.snopark_shipment_entered_by_hand(sh, 'x');
    raise exception 'an unchecked box was accepted';
  exception when invalid_parameter_value then null; end;
  perform public.snopark_shipment_sheet(sh, '{"day":{"from":1,"to":25,"books":1,"permits":25},"season":{"from":null,"to":null,"books":null,"permits":null}}'::jsonb, null, true);
  perform public.snopark_shipment_books(sh, '[{"kind":"day","book_number":"DB 1","first_permit":1,"last_permit":25}]'::jsonb);
  if jsonb_array_length(public.snopark_shipment_check(sh)) <> 0 then raise exception 'should balance'; end if;
  perform public.snopark_shipment_entered_by_hand(sh, 'Trevor entered it Oct 28');
  if (select status from public.snopark_shipments where id = sh) <> 'done' then raise exception 'not done'; end if;
  if (select ls_order_id from public.snopark_shipments where id = sh) is not null then raise exception 'an LS PO was recorded'; end if;
  if (select ls_note from public.snopark_shipments where id = sh) not like 'Entered in Lightspeed by hand%Trevor%' then raise exception 'note'; end if;
  if (select status from public.orders where id = current_setting('t.ord')::uuid) <> 'received' then raise exception 'order'; end if;
end $$;
rollback;
