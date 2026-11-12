-- A box entered by hand with its LS PO writes the PO on the shipment and the order; the LS watch opens the admin's task
-- while the sync fails and closes it when it works again.
begin;
select '00000000-0000-0000-0000-000000000001'::uuid as org \gset
insert into public.vendors (organization_id, name) values (:'org', 'CA SNO-PARK') returning id as csp \gset
insert into public.orders (organization_id, vendor_id, status, order_date, source) values (:'org', :'csp', 'open', '2026-11-02', 'manual') returning id as ord \gset
insert into public.snopark_seasons (organization_id, vendor_id, label, first_report_month, season_end, final_due) values (:'org', :'csp', '2026-2027', '2026-11-01', '2027-05-30', '2027-06-20') returning id as season \gset
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select set_config('t.season', :'season', false);
select set_config('t.ord', :'ord', false);
do $$ declare sh uuid; begin
  sh := public.snopark_shipment_start(current_setting('t.season')::uuid, '2026-11-06', current_setting('t.ord')::uuid);
  perform public.snopark_shipment_sheet(sh, '{"rows":[{"kind":"day","from":1,"to":25}]}'::jsonb, null, true);
  perform public.snopark_shipment_books(sh, '[{"kind":"day","book_number":"D 1","first_permit":1,"last_permit":25}]'::jsonb);
  perform public.snopark_shipment_check(sh);
  perform public.snopark_shipment_entered_by_hand(sh, null, '89', '145SP-2026');
  if (select ls_order_id from public.snopark_shipments where id = sh) <> '89' then raise exception 'shipment LS PO'; end if;
  if (select ls_order_id || '/' || ls_po_number from public.orders where id = current_setting('t.ord')::uuid) <> '89/145SP-2026' then raise exception 'order LS PO'; end if;
end $$;
select set_config('request.jwt.claims', '', true);
-- the watch
insert into public.ls_sync (organization_id, last_error, updated_at, sales_since) values (:'org', 'Lightspeed said: The refresh token is invalid.', now() - interval '30 minutes', now() - interval '3 hours')
on conflict (organization_id) do update set last_error = excluded.last_error, updated_at = excluded.updated_at, sales_since = excluded.sales_since;
do $$ begin
  if public.ls_connection_watch() <> 1 then raise exception 'no task made'; end if;
  if not exists (select 1 from public.tasks where auto_key = 'ls_down:00000000-0000-0000-0000-000000000001' and done_at is null) then raise exception 'task missing'; end if;
  if public.ls_connection_watch() <> 0 then raise exception 'task made twice'; end if;
  update public.ls_sync set last_error = null;
  perform public.ls_connection_watch();
  if exists (select 1 from public.tasks where auto_key = 'ls_down:00000000-0000-0000-0000-000000000001' and done_at is null) then raise exception 'task not closed'; end if;
  if (select closed_how from public.tasks where auto_key = 'ls_down:00000000-0000-0000-0000-000000000001') <> 'vms' then raise exception 'closed_how'; end if;
end $$;
rollback;
