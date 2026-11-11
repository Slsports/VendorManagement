-- The check with sheet rows: two day ranges and one season range; a missing book in the second range is flagged, a box
-- that matches balances; a range that is not whole books is refused.
begin;
select '00000000-0000-0000-0000-000000000001'::uuid as org \gset
insert into public.vendors (organization_id, name) values (:'org', 'CA SNO-PARK') returning id as csp \gset
insert into public.snopark_seasons (organization_id, vendor_id, label, first_report_month, season_end, final_due) values (:'org', :'csp', '2026-2027', '2026-11-01', '2027-05-30', '2027-06-20') returning id as season \gset
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select set_config('t.season', :'season', false);
do $$ declare sh uuid; d jsonb; begin
  sh := public.snopark_shipment_start(current_setting('t.season')::uuid, '2026-11-20', null);
  perform public.snopark_shipment_sheet(sh, '{"rows":[{"kind":"day","from":100,"to":149,"books":2},{"kind":"day","from":300,"to":324,"books":1},{"kind":"season","from":9001,"to":9020,"books":2}],"shipped_on":"2026-11-17"}'::jsonb, null, true);
  -- the second day range's book is missing from the box
  perform public.snopark_shipment_books(sh, '[{"kind":"day","book_number":"DB 1","first_permit":100,"last_permit":124},{"kind":"day","book_number":"DB 2","first_permit":125,"last_permit":149},{"kind":"season","book_number":"SB 1","first_permit":9001,"last_permit":9010},{"kind":"season","book_number":"SB 2","first_permit":9011,"last_permit":9020}]'::jsonb);
  d := public.snopark_shipment_check(sh);
  if not exists (select 1 from jsonb_array_elements(d) e where e->>'text' like 'The sheet lists day permits 300 to 324; no day books%') then raise exception 'missing range not flagged: %', d; end if;
  if exists (select 1 from jsonb_array_elements(d) e where e->>'kind' = 'season' or e->>'text' like '%outside the sheet%') then raise exception 'only the missing range should be flagged: %', d; end if;
  -- the box with every book balances
  perform public.snopark_shipment_books(sh, '[{"kind":"day","book_number":"DB 1","first_permit":100,"last_permit":124},{"kind":"day","book_number":"DB 2","first_permit":125,"last_permit":149},{"kind":"day","book_number":"DB 9","first_permit":300,"last_permit":324},{"kind":"season","book_number":"SB 1","first_permit":9001,"last_permit":9010},{"kind":"season","book_number":"SB 2","first_permit":9011,"last_permit":9020}]'::jsonb);
  d := public.snopark_shipment_check(sh);
  if jsonb_array_length(d) <> 0 then raise exception 'should balance: %', d; end if;
  if (select status from public.snopark_shipments where id = sh) <> 'balanced' then raise exception 'status'; end if;
  -- a range that is not whole books
  perform public.snopark_shipment_sheet(sh, '{"rows":[{"kind":"day","from":100,"to":148,"books":2}]}'::jsonb, null, true);
  d := public.snopark_shipment_check(sh);
  if not exists (select 1 from jsonb_array_elements(d) e where e->>'text' like '%not a whole number of books%') then raise exception 'uneven range not flagged: %', d; end if;
end $$;
rollback;
