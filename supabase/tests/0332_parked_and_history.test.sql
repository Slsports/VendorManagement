-- Old things park themselves; new mail unparks a conversation; filing unparks a paper; the history date steps back a month
-- while spend is under the cap and never past the first email; a staff mailbox conversation with a vendor on it is shared.
begin;
select '00000000-0000-0000-0000-000000000001'::uuid as org \gset
insert into public.vendors (organization_id, name) values (:'org', 'Park Test 0332') returning id as v \gset
insert into public.email_threads (organization_id, gmail_thread_id, status, last_message_at) values (:'org', 't-0332-old', 'waiting_on_us', now() - interval '14 months') returning id as th_old \gset
insert into public.email_threads (organization_id, gmail_thread_id, status, last_message_at) values (:'org', 't-0332-new', 'waiting_on_us', now() - interval '2 months') returning id as th_new \gset
select set_config('t.old', :'th_old', false), set_config('t.new', :'th_new', false), set_config('t.v', :'v', false), set_config('t.org', :'org', false);
do $$ begin
  if (select parked_at from public.email_threads where id = current_setting('t.old')::uuid) is null then raise exception 'old conversation not parked'; end if;
  if (select parked_at from public.email_threads where id = current_setting('t.new')::uuid) is not null then raise exception 'new conversation parked'; end if;
  -- new mail unparks
  update public.email_threads set last_message_at = now() where id = current_setting('t.old')::uuid;
  if (select parked_at from public.email_threads where id = current_setting('t.old')::uuid) is not null then raise exception 'new mail did not unpark'; end if;
end $$;
-- a task about an old order parks; unparking works for an editor
insert into public.orders (organization_id, vendor_id, status, source, order_date, description) values (:'org', :'v', 'received', 'email', current_date - 500, 'old order') returning id as o \gset
insert into public.tasks (organization_id, title, assigned_to, order_id) values (:'org', 'Old order task 0332', '33333333-3333-3333-3333-333333333333', :'o') returning id as t \gset
select set_config('t.task', :'t', false);
do $$ begin
  if (select parked_at from public.tasks where id = current_setting('t.task')::uuid) is null then raise exception 'old order task not parked'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
select public.park_release('task', :'t');
do $$ begin
  if (select parked_at from public.tasks where id = current_setting('t.task')::uuid) is not null then raise exception 'unpark failed'; end if;
end $$;
-- an old accounting paper needing a look parks; filing it unparks
insert into public.accounting_documents (organization_id, file_name, storage_path, status, doc_date, doc_year, sha256) values (:'org', 'old.pdf', 'x/old.pdf', 'review', current_date - 400, 2025, 'sha0332') returning id as d \gset
select set_config('t.doc', :'d', false);
do $$ begin
  if (select parked_at from public.accounting_documents where id = current_setting('t.doc')::uuid) is null then raise exception 'old paper not parked'; end if;
  update public.accounting_documents set status = 'filed' where id = current_setting('t.doc')::uuid;
  if (select parked_at from public.accounting_documents where id = current_setting('t.doc')::uuid) is not null then raise exception 'filing did not unpark'; end if;
end $$;
-- the history date: steps back a month, never past the first email, not when the day's spend is over the cap
insert into public.email_threads (organization_id, gmail_thread_id) values (:'org', 't-0332-first') returning id as th_f \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, received_at) values (:'org', :'th_f', 'g-0332-first', 'in', 'x@vendor.example', 'first', '2024-01-15');
update public.organizations set read_mail_since = '2024-02-20', history_daily_cap_usd = 10 where id = :'org';
delete from public.ai_usage where organization_id = :'org' and created_at >= current_date;
do $$ begin
  if public.mail_history_step() < 1 then raise exception 'no step'; end if;
  if (select read_mail_since from public.organizations where id = current_setting('t.org')::uuid) <> '2024-01-20' then raise exception 'step %', (select read_mail_since from public.organizations where id = current_setting('t.org')::uuid); end if;
  perform public.mail_history_step();
  if (select read_mail_since from public.organizations where id = current_setting('t.org')::uuid) <> '2024-01-15' then raise exception 'went past the first email'; end if;
  perform public.mail_history_step();
  if (select read_mail_since from public.organizations where id = current_setting('t.org')::uuid) <> '2024-01-15' then raise exception 'stepped past the first email'; end if;
end $$;
update public.organizations set read_mail_since = '2024-06-01' where id = :'org';
insert into public.ai_usage (organization_id, purpose, model, input_tokens, output_tokens, cost_usd, items) values (:'org', 'test', 'test', 0, 0, 25, 1);
do $$ begin
  perform public.mail_history_step();
  if (select read_mail_since from public.organizations where id = current_setting('t.org')::uuid) <> '2024-06-01' then raise exception 'stepped while over the cap'; end if;
end $$;
-- a staff mailbox conversation with a vendor on it is shared, even when only we wrote
insert into public.mailboxes (organization_id, address, label, gmail_box, kind, owner_id, is_active, auto_share_vendor_mail) values (:'org', 'staff0332@shaverlakesports.com', 'Staff 0332', 'staff0332@shaverlakesports.com', 'personal', '33333333-3333-3333-3333-333333333333', true, true) returning id as box \gset
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id) values (:'org', 't-0332-order', :'box') returning id as th_o \gset
insert into public.emails (organization_id, thread_id, mailbox_id, gmail_id, direction, from_email, subject, received_at, vendor_id) values (:'org', :'th_o', :'box', 'g-0332-order', 'out', 'staff0332@shaverlakesports.com', 'Our order', now(), :'v');
select set_config('t.tho', :'th_o', false);
do $$ begin
  perform public.share_vendor_threads(current_setting('t.org')::uuid);
  if (select shared_at from public.email_threads where id = current_setting('t.tho')::uuid) is null then raise exception 'order conversation not shared'; end if;
end $$;
rollback;
