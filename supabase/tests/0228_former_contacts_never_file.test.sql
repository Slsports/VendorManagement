\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Former contacts never file mail'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'FC228 VENDOR') returning id as v \gset
insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, former_at) values ('00000000-0000-0000-0000-000000000001', :'v', 'gone@fc228old.test', 'Gone Rep', now());
insert into public.vendor_emails (organization_id, vendor_id, email, contact_name) values ('00000000-0000-0000-0000-000000000001', :'v', 'here@fc228.test', 'Here Rep');
insert into public.rep_groups (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'FC228 Reps') returning id as g \gset
insert into public.rep_group_contacts (organization_id, rep_group_id, name, email, former_at) values ('00000000-0000-0000-0000-000000000001', :'g', 'Moved On', 'moved@fc228rep.test', now());
insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at) values ('00000000-0000-0000-0000-000000000001', 'fc228a', 'a', now()) returning id as t1 \gset
insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at) values ('00000000-0000-0000-0000-000000000001', 'fc228b', 'b', now()) returning id as t2 \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, received_at) values ('00000000-0000-0000-0000-000000000001', :'t1', 'fc228-1', 'in', 'gone@fc228old.test', 'Hello', now()) returning id as e1 \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, received_at) values ('00000000-0000-0000-0000-000000000001', :'t2', 'fc228-2', 'in', 'here@fc228.test', 'Hello', now()) returning id as e2 \gset
select not public.mail_link_email(:'e1') as former_address_files_nothing;
select public.mail_link_email(:'e2') and (select vendor_id from public.emails where id = :'e2') = :'v' as current_address_files;
insert into public.email_senders (organization_id, sender_key, is_domain) values ('00000000-0000-0000-0000-000000000001', 'moved@fc228rep.test', false) returning id as s \gset
select public.mail_match_rep_senders('00000000-0000-0000-0000-000000000001', array[:'s']::uuid[]) = 0 as former_rep_matches_nothing;
select kind = 'unknown' as sender_still_unknown from public.email_senders where id = :'s';
delete from public.emails where thread_id in (:'t1', :'t2');
delete from public.email_threads where id in (:'t1', :'t2');
delete from public.email_senders where id = :'s';
delete from public.rep_group_contacts where rep_group_id = :'g';
delete from public.rep_groups where id = :'g';
delete from public.vendor_emails where vendor_id = :'v';
delete from public.vendors where id = :'v';
