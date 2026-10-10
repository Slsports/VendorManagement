\set ON_ERROR_STOP on
\pset footer off
\echo '>>> a sure "no reply" goes to Handled; the shipping status shows; a carrier update is filed to the shipper'
reset role;
select set_config('request.jwt.claims', '', false) is not null as as_service;
insert into public.carriers (organization_id, name, mode, email_domains, owner_id) values ('00000000-0000-0000-0000-000000000001', 'Reply LTL', 'ltl', '{replyltl.example}', '33333333-3333-3333-3333-333333333333') returning id as rc \gset
insert into public.email_senders (organization_id, sender_key, is_domain) values ('00000000-0000-0000-0000-000000000001', 'replyltl.example', true) returning id as rs \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Reply Shipper Co') returning id as rv \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'rpl1') returning id as rt \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, snippet, received_at, sender_id)
values ('00000000-0000-0000-0000-000000000001', 'rplm1', :'rt', 'in', 'noreply@replyltl.example', 'Tracking update', 'Status: Completed', now(), :'rs') returning id as re \gset
select public.mail_refresh_thread(:'rt', false);
select status from public.email_threads where id = :'rt';
select count(*) as queued from public.mail_reply_queue('00000000-0000-0000-0000-000000000001', 50) where email_id = :'re';
select public.mail_apply_reply(:'re', 'no', 'Tracking update, delivered', 'delivered', :'rv') as result;
select t.status, t.ship_status, v.name as vendor from public.email_threads t left join public.vendors v on v.id = t.vendor_id where t.id = :'rt';
select count(*) as still_queued from public.mail_reply_queue('00000000-0000-0000-0000-000000000001', 50) where email_id = :'re';

\echo '>>> unsure → a review card for the owner; "No answer needed" three times teaches the sender'
insert into public.email_senders (organization_id, sender_key, is_domain) values ('00000000-0000-0000-0000-000000000001', 'notices@unsure.example', false) returning id as us \gset
insert into public.email_threads (organization_id, gmail_thread_id, owner_id) values ('00000000-0000-0000-0000-000000000001', 'rpl2', '33333333-3333-3333-3333-333333333333') returning id as ut \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, snippet, received_at, sender_id)
values ('00000000-0000-0000-0000-000000000001', 'rplm2', :'ut', 'in', 'notices@unsure.example', 'Account notice', 'FYI', now(), :'us') returning id as ue \gset
select public.mail_refresh_thread(:'ut', false);
select public.mail_apply_reply(:'ue', 'unsure', 'An account notice; maybe nothing to do', null, null) as result;
select id as ri, kind, assigned_to = '33333333-3333-3333-3333-333333333333'::uuid as to_owner from public.review_items where kind = 'mail_reply' and entity_id = :'ut' and status = 'pending' \gset
select :'kind' as kind, :'to_owner' as to_owner;
update public.email_senders set no_reply_answers = 2 where id = :'us';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select public.answer_mail_reply(:'ri', false);
reset role;
select status from public.email_threads where id = :'ut';
select no_reply_answers, auto_no_reply from public.email_senders where id = :'us';
\echo '>>> the taught sender: the next unsure email goes straight to Handled'
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, snippet, received_at, sender_id)
values ('00000000-0000-0000-0000-000000000001', 'rplm3', :'ut', 'in', 'notices@unsure.example', 'Account notice 2', 'FYI', now() + interval '1 minute', :'us') returning id as ue2 \gset
select public.mail_refresh_thread(:'ut', false);
select status from public.email_threads where id = :'ut';
select public.mail_apply_reply(:'ue2', 'unsure', 'Another notice', null, null) as result;
\echo '>>> a viewer cannot answer cards (expect 1 error)'
\set ON_ERROR_STOP off
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', false);
select public.answer_mail_reply(:'ri', true);
\set ON_ERROR_STOP on
reset role;
