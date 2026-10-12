\set ON_ERROR_STOP on
\pset footer off
\echo '>>> our reply promising to look tomorrow: waiting on us, and a task for whoever signed it'
reset role;
select id as admin_id, split_part(full_name, ' ', 1) as admin_first from public.profiles where role = 'admin' and organization_id = '00000000-0000-0000-0000-000000000001' order by created_at limit 1 \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'prt1') returning id as pt \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at)
values ('00000000-0000-0000-0000-000000000001', 'prm1', :'pt', 'in', 'dom@promise.example', 'Does this look right?', now() - interval '1 hour');
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, body_text, received_at)
values ('00000000-0000-0000-0000-000000000001', 'prm2', :'pt', 'out', 'orders@example.com', 'Re: Does this look right?', 'I will look at this tomorrow!', now()) returning id as pe \gset
select public.mail_refresh_thread(:'pt');
select status from public.email_threads where id = :'pt';
select count(*) as queued from public.mail_promise_queue('00000000-0000-0000-0000-000000000001') where email_id = :'pe';
select public.mail_apply_promise(:'pe', true, 'Check the order', current_date + 1, 'I will look at this tomorrow!', :'admin_first') is not null as task_made;
select status, follow_up_at is null as no_follow_up from public.email_threads where id = :'pt';
select title, due_date = current_date + 1 as due_tomorrow, assigned_to = :'admin_id' as for_signer, thread_id = :'pt' as tagged from public.tasks where auto_key = 'promise:' || :'pe';
select public.mail_refresh_thread(:'pt');
select status as still_on_us from public.email_threads where id = :'pt';
\echo '>>> finishing the task puts it back on the vendor'
update public.tasks set done_at = now() where auto_key = 'promise:' || :'pe';
select status, follow_up_at is not null as follow_up from public.email_threads where id = :'pt';
\echo '>>> a new reply of ours ends an open promise'
update public.tasks set done_at = null where auto_key = 'promise:' || :'pe';
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, body_text, received_at)
values ('00000000-0000-0000-0000-000000000001', 'prm3', :'pt', 'out', 'orders@example.com', 'Re: Does this look right?', 'Looks good, thanks!', now() + interval '1 minute');
select public.mail_refresh_thread(:'pt');
select done_note from public.tasks where auto_key = 'promise:' || :'pe';
select status from public.email_threads where id = :'pt';
