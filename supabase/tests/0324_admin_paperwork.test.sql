-- Administrative paperwork is Dana's; the back-check moves an open one; a shared mailbox conversation can be handed over,
-- a private one says so.
begin;
select '00000000-0000-0000-0000-000000000001'::uuid as org \gset
select id as dana from public.profiles where organization_id = :'org' and role = 'admin' and is_active order by created_at limit 1 \gset
insert into public.mailboxes (organization_id, address, label, gmail_box, kind, owner_id, is_active) values (:'org', 'buyer0324@shaverlakesports.com', 'Buyer 0324', 'buyer0324@shaverlakesports.com', 'personal', '33333333-3333-3333-3333-333333333333', true) returning id as box \gset
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id) values (:'org', 't-0324-a', :'box') returning id as th \gset
insert into public.emails (organization_id, thread_id, mailbox_id, gmail_id, direction, from_email, from_name, subject, received_at)
values (:'org', :'th', :'box', 'g-0324-1', 'in', 'susan@vendor.example', 'Susan Vendor', 'Credit application', now()) returning id as e1 \gset
insert into public.emails (organization_id, thread_id, mailbox_id, gmail_id, direction, from_email, from_name, subject, received_at)
values (:'org', :'th', :'box', 'g-0324-2', 'in', 'susan@vendor.example', 'Susan Vendor', 'Order worksheet', now()) returning id as e2 \gset
select set_config('t.dana', :'dana', false), set_config('t.e1', :'e1', false), set_config('t.e2', :'e2', false), set_config('t.th', :'th', false);
do $$ declare dana uuid := current_setting('t.dana')::uuid; t1 uuid; t2 uuid; begin
  t1 := public.task_from_ask(current_setting('t.e1')::uuid, 'the credit card application', null, true);
  t2 := public.task_from_ask(current_setting('t.e2')::uuid, 'the order worksheet', null, false);
  if (select assigned_to from public.tasks where id = t1) <> dana then raise exception 'admin paperwork not Dana''s'; end if;
  if (select ask_admin from public.tasks where id = t1) is not true then raise exception 'ask_admin not set'; end if;
  if (select assigned_to from public.tasks where id = t2) <> '33333333-3333-3333-3333-333333333333' then raise exception 'order paperwork left the mailbox owner'; end if;
  -- the back-check: an old task made the old way (owner's, unjudged) turns out administrative → moved to Dana
  update public.tasks set assigned_to = '33333333-3333-3333-3333-333333333333', ask_admin = null where id = t1;
  if not public.ask_task_route(t1, true) then raise exception 'route did not move it'; end if;
  if (select assigned_to from public.tasks where id = t1) <> dana then raise exception 'not moved to Dana'; end if;
  if (select notes from public.tasks where id = t1) not like '%Moved from % to Dana%' then raise exception 'note: %', (select notes from public.tasks where id = t1); end if;
  if public.ask_task_route(t2, false) then raise exception 'a buyer''s paperwork moved'; end if;
  if (select ask_admin from public.tasks where id = t2) is not false then raise exception 'ask_admin false not kept'; end if;
end $$;
-- handing over: private → refused with a plain message; shared → allowed and kept
select set_config('request.jwt.claims', '{"sub":"' || :'dana' || '","role":"authenticated"}', true);
do $$ declare th uuid := current_setting('t.th')::uuid; dana uuid := current_setting('t.dana')::uuid; begin
  begin
    perform public.assign_email_thread(th, dana);
    raise exception 'a private conversation was handed over';
  exception when invalid_parameter_value then
    if sqlerrm not like 'This conversation is in %''s own mailbox%' then raise exception 'message: %', sqlerrm; end if;
  end;
  if (select owner_id from public.email_threads where id = th) <> '33333333-3333-3333-3333-333333333333' then raise exception 'owner changed'; end if;
  update public.email_threads set shared_at = now() where id = th;
  perform public.assign_email_thread(th, dana);
  if (select owner_id from public.email_threads where id = th) <> dana then raise exception 'a shared conversation could not be handed to Dana'; end if;
end $$;
rollback;
