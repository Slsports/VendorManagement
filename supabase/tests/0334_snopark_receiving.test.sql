-- Sno-Park receiving: a shipment with the State's sheet and the books entered one row each; the check flags a short book,
-- a missing book and a count that does not match; the flag makes the person's task and the draft to the State (cc the
-- admin); a balanced box can be marked done, which receives the order and closes the task; the season compare adds up.
begin;
select '00000000-0000-0000-0000-000000000001'::uuid as org \gset
insert into public.vendors (organization_id, name) values (:'org', 'CA SNOW PARK') returning id as csp \gset
insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, contact_type, roles) values (:'org', :'csp', 'ohmvr.permits@parks.ca.gov', null, 'orders', '{orders}');
insert into public.orders (organization_id, vendor_id, status, order_date, po_number, source) values (:'org', :'csp', 'open', '2026-11-01', 'CASNOWPARK110126', 'manual') returning id as ord \gset
insert into public.snopark_seasons (organization_id, vendor_id, label, first_report_month, season_end, final_due) values (:'org', :'csp', '2026-2027', '2026-11-01', '2027-05-30', '2027-06-20') returning id as season \gset
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select set_config('t.season', :'season', false);
select set_config('t.ord', :'ord', false);
do $$ declare s uuid := current_setting('t.season')::uuid; sh uuid; d jsonb; n integer; t uuid; begin
  sh := public.snopark_shipment_start(s, '2026-11-20', null);
  if (select order_id from public.snopark_shipments where id = sh) <> current_setting('t.ord')::uuid then raise exception 'the open order was not picked up'; end if;
  perform set_config('t.sh', sh::text, false);
  -- the sheet as the person confirmed it: 3 day books of 25 (7751-7825), 2 season books of 10 (10591-10610)
  perform public.snopark_shipment_sheet(sh, '{"season_label":"2026-2027","shipped_on":"2026-11-17","day":{"from":7751,"to":7825,"books":3,"permits":75},"season":{"from":10591,"to":10610,"books":2,"permits":20}}'::jsonb, null, true);
  -- books: one day book short (24 permits), one day book missing, season right
  n := public.snopark_shipment_books(sh, '[{"kind":"day","book_number":"DB 543","first_permit":7751,"last_permit":7775},{"kind":"day","book_number":"DB 544","first_permit":7776,"last_permit":7799},{"kind":"season","book_number":"SB 1130","first_permit":10591,"last_permit":10600},{"kind":"season","book_number":"SB 1131","first_permit":10601,"last_permit":10610}]'::jsonb);
  if n <> 4 then raise exception 'books entered: %', n; end if;
  d := public.snopark_shipment_check(sh);
  if (select status from public.snopark_shipments where id = sh) <> 'off' then raise exception 'a short box should be off'; end if;
  if not exists (select 1 from jsonb_array_elements(d) e where e->>'text' like 'Day book DB 544 holds 24 permits%') then raise exception 'short book not flagged: %', d; end if;
  if not exists (select 1 from jsonb_array_elements(d) e where e->>'text' like '26 permits in the sheet''s day range%') then raise exception 'missing permits not flagged: %', d; end if;
  if not exists (select 1 from jsonb_array_elements(d) e where e->>'text' like 'The sheet says 3 day books were issued; 2 entered.') then raise exception 'book count not flagged: %', d; end if;
  if exists (select 1 from jsonb_array_elements(d) e where e->>'kind' = 'season') then raise exception 'season books were right: %', d; end if;
  -- the flag: a task for the person entering, with the draft to the State's orders contact, cc the admin
  t := public.snopark_shipment_flag(sh);
  if (select assigned_to from public.tasks where id = t) <> '33333333-3333-3333-3333-333333333333' then raise exception 'task owner'; end if;
  if (select auto_key from public.tasks where id = t) <> 'snopark_ship:' || sh then raise exception 'task key'; end if;
  if not exists (select 1 from public.email_drafts dr join public.tasks tk on tk.draft_id = dr.id where tk.id = t and dr.owner_id = '33333333-3333-3333-3333-333333333333' and 'ohmvr.permits@parks.ca.gov' = any(dr.to_emails) and dr.body like '%DB 544 holds 24 permits%') then raise exception 'draft to the State'; end if;
  -- the box is fixed: the right books, and it balances
  n := public.snopark_shipment_books(sh, '[{"kind":"day","book_number":"DB 543","first_permit":7751,"last_permit":7775},{"kind":"day","book_number":"DB 544","first_permit":7776,"last_permit":7800},{"kind":"day","book_number":"DB 545","first_permit":7801,"last_permit":7825},{"kind":"season","book_number":"SB 1130","first_permit":10591,"last_permit":10600},{"kind":"season","book_number":"SB 1131","first_permit":10601,"last_permit":10610}]'::jsonb);
  d := public.snopark_shipment_check(sh);
  if jsonb_array_length(d) <> 0 then raise exception 'should balance: %', d; end if;
  if (select status from public.snopark_shipments where id = sh) <> 'balanced' then raise exception 'status balanced'; end if;
  -- a book corrected while on hand; an overlap is refused
  perform public.snopark_book_update((select id from public.snopark_books where book_number = 'DB 545'), 'DB 546', 7801, 7825);
  begin
    perform public.snopark_book_update((select id from public.snopark_books where book_number = 'DB 546'), 'DB 546', 7790, 7825);
    raise exception 'an overlap was accepted';
  exception when unique_violation then null; end;
  -- a non-admin cannot accept a box that is off
  begin
    perform public.snopark_shipment_accept(sh, 'x');
    raise exception 'a buyer accepted a box';
  exception when insufficient_privilege or invalid_parameter_value then null; end;
end $$;
-- done, from the function (service role)
reset role;
select set_config('request.jwt.claims', '', true);
set local role service_role;
do $$ declare sh uuid := current_setting('t.sh')::uuid; begin
  perform public.snopark_shipment_done(sh, '9123', 'PO 9123 checked in: 75 day, 20 season.');
  if (select status from public.snopark_shipments where id = sh) <> 'done' then raise exception 'done'; end if;
  if (select status from public.orders where id = current_setting('t.ord')::uuid) <> 'received' then raise exception 'order received'; end if;
  if exists (select 1 from public.tasks where auto_key = 'snopark_ship:' || sh and done_at is null) then raise exception 'flag task not closed'; end if;
  if (select closed_how from public.tasks where auto_key = 'snopark_ship:' || sh) <> 'vms' then raise exception 'closed_how'; end if;
  -- the season compare: nothing reported, nothing sold in LS → not off
  if (public.snopark_season_compare(current_setting('t.season')::uuid)->>'off')::boolean then raise exception 'compare off with nothing on either side'; end if;
end $$;
rollback;
