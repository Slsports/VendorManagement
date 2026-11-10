-- Sno-Park orders and the map: an order gets the next number, a VMS order behind it, Dana's file name; the email with
-- its number marks it sent; the first box done makes the map task, and marking the map printed closes it; the signatures
-- bucket exists; the season opens with its packet pending.
begin;
select '00000000-0000-0000-0000-000000000001'::uuid as org \gset
insert into public.vendors (organization_id, name) values (:'org', 'CA SNO-PARK') returning id as csp \gset
insert into public.email_threads (organization_id, gmail_thread_id) values (:'org', 't-sno-0336') returning id as th \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, received_at)
values (:'org', :'th', 'g-sno-0336', 'in', 'monica.perez@parks.ca.gov', '2027-2028 SnoPark Season - Vendor Registration', '2027-09-01 15:00+00') returning id as packet \gset
select id as season from public.snopark_seasons where organization_id = :'org' and label = '2027-2028' \gset
select set_config('t.season', :'season', false);
select set_config('t.th', :'th', false);
do $$ begin
  if (select packet_status from public.snopark_seasons where id = current_setting('t.season')::uuid) <> 'pending' then raise exception 'packet not pending'; end if;
  if not exists (select 1 from storage.buckets where id = 'signatures' and not public) then raise exception 'signatures bucket'; end if;
  if public.snopark_order_name(1, '2026-11-02', '2026-2027') <> '#1 - 11-2-26 - OHV 145SP-2026-2027 - SLS Vendor Permit Request Form' then raise exception 'order name: %', public.snopark_order_name(1, '2026-11-02', '2026-2027'); end if;
end $$;
-- the first order, made by the function (no user), then one by the test buyer
do $$ declare o1 uuid; o2 uuid; begin
  o1 := public.snopark_order_start(current_setting('t.season')::uuid, 20, 10, '2027-09-05', '33333333-3333-3333-3333-333333333333');
  if (select seq from public.snopark_orders where id = o1) <> 1 then raise exception 'seq 1'; end if;
  if (select status from public.orders where id = (select order_id from public.snopark_orders where id = o1)) <> 'open' then raise exception 'vms order'; end if;
  perform set_config('t.o1', o1::text, false);
end $$;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
do $$ declare o2 uuid; begin
  o2 := public.snopark_order_start(current_setting('t.season')::uuid, 10, 0, '2027-12-15', null);
  if (select seq from public.snopark_orders where id = o2) <> 2 then raise exception 'seq 2'; end if;
  if (select requested_by from public.snopark_orders where id = o2) <> '33333333-3333-3333-3333-333333333333' then raise exception 'requested_by'; end if;
  begin
    perform public.snopark_order_start(current_setting('t.season')::uuid, 0, 0, null, null);
    raise exception 'an empty order was accepted';
  exception when invalid_parameter_value then null; end;
end $$;
select set_config('request.jwt.claims', '', true);
-- the emails: the packet reply sends #1; the numbered subject sends #2
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, received_at)
values (:'org', :'th', 'g-sno-0336-out1', 'out', 'billing@shaverlakesports.com', 'Re: 2027-2028 SnoPark Season - Vendor Registration', '2027-09-06 15:00+00');
insert into public.email_threads (organization_id, gmail_thread_id) values (:'org', 't-sno-0336-b') returning id as th2 \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, received_at)
values (:'org', :'th2', 'g-sno-0336-out2', 'out', 'orders@shaverlakesports.com', 'Sno-Park Permit Request #2 – 2027-2028', '2027-12-15 18:00+00');
do $$ begin
  if (select status from public.snopark_orders where seq = 1 and season_id = current_setting('t.season')::uuid) <> 'sent' then raise exception '#1 not sent'; end if;
  if (select status from public.snopark_orders where seq = 2 and season_id = current_setting('t.season')::uuid) <> 'sent' then raise exception '#2 not sent'; end if;
  if (select sent_on from public.snopark_orders where seq = 2 and season_id = current_setting('t.season')::uuid) <> '2027-12-15' then raise exception 'sent_on'; end if;
end $$;
-- the map task when the first box is done
insert into public.vendor_links (organization_id, vendor_id, kind, label, url) values (:'org', :'csp', 'snopark_packet_doc', '2027-2028 SNO-PARK MAP', 'https://example.com/map.pdf') returning id as map \gset
update public.snopark_seasons set map_link_id = :'map' where id = :'season';
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
do $$ declare sh uuid; begin
  sh := public.snopark_shipment_start(current_setting('t.season')::uuid, '2027-09-20', null);
  perform set_config('t.sh', sh::text, false);
end $$;
select set_config('request.jwt.claims', '', true);
set local role service_role;
do $$ begin
  perform public.snopark_shipment_done(current_setting('t.sh')::uuid, '77', 'ok');
  if not exists (select 1 from public.tasks where auto_key = 'snopark_map:' || current_setting('t.season') and done_at is null and assigned_to = '33333333-3333-3333-3333-333333333333') then raise exception 'map task'; end if;
  if (select status from public.snopark_orders where seq = 1 and season_id = current_setting('t.season')::uuid) <> 'sent' then raise exception 'order #1 should stay sent (box not tied to it)'; end if;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
do $$ begin
  perform public.snopark_map_printed(current_setting('t.season')::uuid);
  if exists (select 1 from public.tasks where auto_key = 'snopark_map:' || current_setting('t.season') and done_at is null) then raise exception 'map task not closed'; end if;
  if (select closed_how from public.tasks where auto_key = 'snopark_map:' || current_setting('t.season')) <> 'person' then raise exception 'closed_how'; end if;
end $$;
rollback;
