\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Artwork approvals: a proof goes to the art approver; our "approved" closes it; unsure asks'
reset role;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
select public.art_approver('00000000-0000-0000-0000-000000000001') = :'admin_id' as approver_is_admin;
insert into public.email_threads (organization_id, gmail_thread_id, status) values ('00000000-0000-0000-0000-000000000001', 'art-thread', 'waiting_on_us') returning id as th \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, subject, received_at) values ('00000000-0000-0000-0000-000000000001', 'art-1', :'th', 'in', 'Proof for Shaver Lake hoodie', now() - interval '3 days') returning id as e1 \gset
select count(*) > 0 as queued from public.mail_art_queue('00000000-0000-0000-0000-000000000001', 50) where email_id = :'e1';
select public.mail_apply_art(:'e1', 'yes', 'Proof attached, waiting on approval') as applied;
select art_status, owner_id = :'admin_id' as mine, art_since is not null as since from public.email_threads where id = :'th';
insert into public.emails (organization_id, gmail_id, thread_id, direction, received_at) values ('00000000-0000-0000-0000-000000000001', 'art-2', :'th', 'out', now()) returning id as e2 \gset
select count(*) > 0 as our_reply_queued from public.mail_art_queue('00000000-0000-0000-0000-000000000001', 50) where email_id = :'e2';
select public.mail_apply_art(:'e2', 'approved', 'Dana approved it') as ours;
select art_status from public.email_threads where id = :'th';
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'art-thread-2') returning id as th2 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, received_at) values ('00000000-0000-0000-0000-000000000001', 'art-3', :'th2', 'in', now()) returning id as e3 \gset
select public.mail_apply_art(:'e3', 'unsure', 'Mentions a logo') as unsure;
select kind, assigned_to = :'admin_id' as to_approver from public.review_items where entity_id = :'th2';
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
select public.set_art_status(:'th2', 'waiting');
reset role;
select art_status, (select status from public.review_items where entity_id = :'th2') as card from public.email_threads where id = :'th2';
