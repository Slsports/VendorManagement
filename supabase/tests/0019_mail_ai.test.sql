\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Claude reading: an unsure email Claude calls an offer moves; a taught sender still wins; a sender card takes Claude''s vendor'
reset role;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'AI Read Co') returning id as av \gset
insert into public.email_senders (organization_id, sender_key) values ('00000000-0000-0000-0000-000000000001', 'airead.example') returning id as asd \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'ai1') returning id as at1 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at, sender_id, is_bulk)
values ('00000000-0000-0000-0000-000000000001', 'aim1', :'at1', 'in', 'hello@airead.example', 'Something new for you', now(), :'asd', false) returning id as ae \gset
select public.mail_process('00000000-0000-0000-0000-000000000001', array[:'ae']::uuid[], false) as processed;
select count(*) as unsure_listed from public.mail_unsure_emails('00000000-0000-0000-0000-000000000001') where id = :'ae';
select public.mail_set_ai_views('00000000-0000-0000-0000-000000000001', array[:'ae']::uuid[], array['offers']) as changed;
select view, view_how from public.emails where id = :'ae';
select count(*) as listed_again from public.mail_unsure_emails('00000000-0000-0000-0000-000000000001') where id = :'ae';
update public.email_senders set view_rule = 'attention' where id = :'asd';
select public.mail_classify('00000000-0000-0000-0000-000000000001', array[:'ae']::uuid[]) as changed;
select view, view_how from public.emails where id = :'ae';
select public.mail_set_sender_ai(:'asd', 'vendor', :'av', 'signs as AI Read Co sales');
select title, details->>'proposal_note' as why from public.review_items where entity_id = :'asd';
\echo '>>> invoices and replies never go to Claude'
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'ai2') returning id as at2 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at, is_bulk)
values ('00000000-0000-0000-0000-000000000001', 'aim2', :'at2', 'in', 'x@other.example', 'Invoice 55 from Other', now(), false),
       ('00000000-0000-0000-0000-000000000001', 'aim3', :'at2', 'in', 'x@other.example', 'Re: hello', now(), false);
select count(*) as sent_to_claude from public.mail_unsure_emails('00000000-0000-0000-0000-000000000001') u join public.emails e on e.id = u.id where e.gmail_id in ('aim2', 'aim3');
