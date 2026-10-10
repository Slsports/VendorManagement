\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Artwork: Needs changes stays on us until the changes are sent; a new proof brings it back to waiting'
reset role;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
insert into public.email_threads (organization_id, gmail_thread_id, status) values ('00000000-0000-0000-0000-000000000001', 'art-cs-thread', 'waiting_on_us') returning id as th \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, received_at) values ('00000000-0000-0000-0000-000000000001', 'art-cs-1', :'th', 'in', now() - interval '3 days') returning id as e1 \gset
select public.mail_apply_art(:'e1', 'yes', 'Proof attached') as applied;
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
select public.set_art_status(:'th', 'needs_changes');
reset role;
select art_status as after_button from public.email_threads where id = :'th';
insert into public.emails (organization_id, gmail_id, thread_id, direction, received_at) values ('00000000-0000-0000-0000-000000000001', 'art-cs-2', :'th', 'out', now() - interval '1 day') returning id as e2 \gset
select public.mail_apply_art(:'e2', 'changes', 'Asked for a darker blue') as our_reply;
select art_status as after_reply from public.email_threads where id = :'th';
insert into public.emails (organization_id, gmail_id, thread_id, direction, received_at) values ('00000000-0000-0000-0000-000000000001', 'art-cs-3', :'th', 'in', now()) returning id as e3 \gset
select public.mail_apply_art(:'e3', 'yes', 'New proof') as new_proof;
select art_status as after_new_proof, art_since > now() - interval '1 minute' as clock_restarted from public.email_threads where id = :'th';
set role authenticated;
select public.set_art_status(:'th', 'changes_sent');
reset role;
select art_status as button_changes_sent from public.email_threads where id = :'th';
