-- Sno-Park: the packet email opens the season with Dana's task; books number themselves; the month's report and task
-- appear once the month has ended; building a report lists the empty books and works out the check; mailing returns the
-- books and closes the tasks; the final lists partly sold and unsold books and closes the season.
begin;
select '00000000-0000-0000-0000-000000000001'::uuid as org \gset
insert into public.vendors (organization_id, name) values (:'org', 'CA SNOW PARK') returning id as csp \gset
insert into public.email_threads (organization_id, gmail_thread_id) values (:'org', 't-sno-0317') returning id as th \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, received_at)
values (:'org', :'th', 'g-sno-1', 'in', 'monica.perez@parks.ca.gov', '2026-2027 SnoPark Season - Vendor Registration', '2026-09-01 15:00+00') returning id as packet \gset
select id as season from public.snopark_seasons where organization_id = :'org' and label = '2026-2027' \gset
do $$ begin
  if (select count(*) from public.snopark_seasons where label = '2026-2027') <> 1 then raise exception 'the packet email did not open the season'; end if;
  if (select first_report_month from public.snopark_seasons where label = '2026-2027') <> '2026-11-01' then raise exception 'first report month'; end if;
  if (select final_due from public.snopark_seasons where label = '2026-2027') <> '2027-06-20' then raise exception 'final due'; end if;
  if not exists (select 1 from public.tasks where auto_key like 'snopark_packet:%' and done_at is null) then raise exception 'no packet task for Dana'; end if;
end $$;
-- a Re: does not open a second season; our reply closes the packet task
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, received_at)
values (:'org', :'th', 'g-sno-2', 'in', 'monica.perez@parks.ca.gov', 'Re: 2026-2027 SnoPark Season - Vendor Registration', '2026-09-02 15:00+00');
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, received_at)
values (:'org', :'th', 'g-sno-3', 'out', 'billing@shaverlakesports.com', 'Re: 2026-2027 SnoPark Season - Vendor Registration', '2026-09-03 15:00+00');
do $$ begin
  if (select count(*) from public.snopark_seasons) <> 1 then raise exception 'a Re: opened a season'; end if;
  if exists (select 1 from public.tasks where auto_key like 'snopark_packet:%' and done_at is null) then raise exception 'the reply did not close the packet task'; end if;
  if (select closed_how from public.tasks where auto_key like 'snopark_packet:%') <> 'vms' then raise exception 'closed_how'; end if;
end $$;

-- books, entered by the test buyer
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select set_config('t.season', :'season', false);
do $$ declare s uuid := current_setting('t.season')::uuid; begin
  if public.snopark_books_add(s, 'day', 'B450', 3, 25, 5726, '2026-11-20', null) <> 3 then raise exception 'books added'; end if;
  if public.snopark_books_add(s, 'season', 'S12', 2, 10, 8551, '2026-11-20', null) <> 2 then raise exception 'season books added'; end if;
  if (select string_agg(book_number || ':' || first_permit || '-' || last_permit, ' ' order by first_permit) from public.snopark_books where season_id = s and kind = 'day') <> 'B450:5726-5750 B451:5751-5775 B452:5776-5800' then
    raise exception 'book numbering: %', (select string_agg(book_number || ':' || first_permit || '-' || last_permit, ' ' order by first_permit) from public.snopark_books where season_id = s and kind = 'day'); end if;
  begin
    perform public.snopark_books_add(s, 'day', 'B452', 1, 25, 5776, null, null);
    raise exception 'a duplicate book was accepted';
  exception when unique_violation then null; end;
end $$;

-- the month's report: November's appears once December has started (the cron looks at today, so call ensure directly)
do $$ declare s uuid := current_setting('t.season')::uuid; r uuid; t public.tasks%rowtype; begin
  r := public.snopark_report_ensure(s, 'monthly', '2026-11-01');
  select * into t from public.tasks where auto_key = 'snopark:' || r;
  if t.id is null then raise exception 'no report task'; end if;
  if t.due_date <> '2026-12-15' then raise exception 'November report due %', t.due_date; end if;
  if (select seq from public.snopark_reports where id = r) <> 1 then raise exception 'seq'; end if;
  if public.snopark_report_ensure(s, 'monthly', '2026-11-01') <> r then raise exception 'ensure made a second report'; end if;
  perform set_config('t.report', r::text, false);
end $$;

-- build: two empty day books and one season book → the State's numbers
do $$ declare s uuid := current_setting('t.season')::uuid; r uuid := current_setting('t.report')::uuid; b1 uuid; b2 uuid; sb uuid; rep public.snopark_reports%rowtype; begin
  select id into b1 from public.snopark_books where season_id = s and book_number = 'B450';
  select id into b2 from public.snopark_books where season_id = s and book_number = 'B451';
  select id into sb from public.snopark_books where season_id = s and book_number = 'S12';
  perform public.snopark_report_build(r, jsonb_build_array(jsonb_build_object('book_id', b1), jsonb_build_object('book_id', b2), jsonb_build_object('book_id', sb)));
  select * into rep from public.snopark_reports where id = r;
  if rep.day_qty <> 50 or rep.day_amount <> 750 or rep.day_commission <> 90 or rep.day_due <> 660 then raise exception 'day numbers % % % %', rep.day_qty, rep.day_amount, rep.day_commission, rep.day_due; end if;
  if rep.season_qty <> 10 or rep.season_amount <> 400 or rep.season_commission <> 24 or rep.season_due <> 376 then raise exception 'season numbers'; end if;
  if rep.total_due <> 1036 then raise exception 'total due %', rep.total_due; end if;
  if (select count(*) from public.snopark_report_rows where report_id = r and section = 'sold') <> 3 then raise exception 'rows'; end if;
  if (select status from public.snopark_books where id = b1) <> 'empty' then raise exception 'book not marked empty'; end if;
  -- a partly sold book is refused on a monthly report
  begin
    perform public.snopark_report_build(r, jsonb_build_array(jsonb_build_object('book_id', b1, 'to_permit', 5740)));
    raise exception 'a partial book was accepted on a monthly report';
  exception when invalid_parameter_value then null; end;
  -- built again with one book: the other goes back to on hand
  perform public.snopark_report_build(r, jsonb_build_array(jsonb_build_object('book_id', b1)));
  if (select status from public.snopark_books where id = b2) <> 'on_hand' then raise exception 'rebuild did not free the book'; end if;
  if (select total_due from public.snopark_reports where id = r) <> 330 then raise exception 'rebuilt total'; end if;
end $$;

-- ready (the Excel is made) → Dana's check task; mailed → books returned, both tasks closed
reset role;
do $$ declare r uuid := current_setting('t.report')::uuid; rep public.snopark_reports%rowtype; begin
  perform public.snopark_report_ready(r, null);
  select * into rep from public.snopark_reports where id = r;
  if rep.status <> 'ready' or rep.check_task_id is null then raise exception 'not ready or no check task'; end if;
  if (select title from public.tasks where id = rep.check_task_id) not like 'Sno-Park check for $330.00%' then raise exception 'check task title: %', (select title from public.tasks where id = rep.check_task_id); end if;
  perform public.snopark_report_mailed(r, '2026-12-14', '9400 1234');
  select * into rep from public.snopark_reports where id = r;
  if rep.status <> 'mailed' or rep.tracking <> '9400 1234' then raise exception 'not mailed'; end if;
  if (select status from public.snopark_books where book_number = 'B450') <> 'returned' then raise exception 'book not returned'; end if;
  if exists (select 1 from public.tasks where id in (rep.task_id, rep.check_task_id) and done_at is null) then raise exception 'tasks still open'; end if;
  if (select done_note from public.tasks where id = rep.task_id) not like 'Mailed Dec 14, 2026 with the check for $330.00 and 1 book (tracking 9400 1234).' then raise exception 'done note: %', (select done_note from public.tasks where id = rep.task_id); end if;
  begin
    perform public.snopark_report_build(r, '[]'::jsonb);
    raise exception 'a mailed report was rebuilt';
  exception when invalid_parameter_value then null; end;
end $$;

-- the final: a partly sold book (B451 sold to 5760) and an untouched one (B452, S13) → sold rows plus unsold rows; season closes
do $$ declare s uuid := current_setting('t.season')::uuid; f uuid; b2 uuid; rep public.snopark_reports%rowtype; begin
  f := public.snopark_report_ensure(s, 'final', '2027-05-01');
  if (select due_on from public.snopark_reports where id = f) <> '2027-06-20' then raise exception 'final due'; end if;
  select id into b2 from public.snopark_books where season_id = s and book_number = 'B451';
  perform public.snopark_report_build(f, jsonb_build_array(jsonb_build_object('book_id', b2, 'to_permit', 5760)));
  select * into rep from public.snopark_reports where id = f;
  if rep.day_qty <> 10 or rep.total_due <> 132 then raise exception 'final numbers % %', rep.day_qty, rep.total_due; end if;
  if (select string_agg(book_number || ':' || from_permit || '-' || to_permit, ' ' order by sort) from public.snopark_report_rows where report_id = f and section = 'unsold') <> 'B451:5761-5775 B452:5776-5800 S12:8551-8560 S13:8561-8570' then
    raise exception 'unsold rows: %', (select string_agg(book_number || ':' || from_permit || '-' || to_permit, ' ' order by sort) from public.snopark_report_rows where report_id = f and section = 'unsold'); end if;
  perform public.snopark_report_mailed(f, '2027-06-10', null);
  if (select status from public.snopark_seasons where id = s) <> 'closed' then raise exception 'season not closed'; end if;
  if exists (select 1 from public.snopark_books where season_id = s and status <> 'returned') then raise exception 'a book did not go back'; end if;
end $$;

-- the LS check runs (no sales in the test database)
do $$ declare s uuid := current_setting('t.season')::uuid; begin
  perform * from public.snopark_ls_sold(s, '2027-01-01');
end $$;
rollback;
