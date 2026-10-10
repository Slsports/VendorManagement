\set ON_ERROR_STOP on
\pset footer off
\echo '>>> mail views: Promotions and bulk mail go to offers, orders and replies stay in attention'
reset role;
select public.mail_view_for('in', array['CATEGORY_PROMOTIONS'], 'Fall catalog is here', 'news@brand.com', null, null, false) as promo,
       public.mail_view_for('in', array['CATEGORY_PROMOTIONS'], 'Your order #123 has shipped', 'noreply@brand.com', true, null, false) as shipped,
       public.mail_view_for('in', '{}', 'Today''s New Product Alert', 'info@x.com', null, null, false) as alert,
       public.mail_view_for('in', '{}', 'Re: Spring catalog', 'amy@x.com', true, null, false) as reply,
       public.mail_view_for('in', '{}', 'Hello', 'amy@x.com', null, null, false) as unsure,
       public.mail_view_for('in', '{}', 'Hello', 'amy@x.com', null, 'offers', false) as taught;
\echo '>>> moving a conversation teaches the sender; its other mail follows; a conversation we wrote in stays in attention'
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'View Test Co') returning id as vv \gset
insert into public.email_senders (organization_id, sender_key) values ('00000000-0000-0000-0000-000000000001', 'viewtest.example') returning id as vs \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'vt1'), ('00000000-0000-0000-0000-000000000001', 'vt2'), ('00000000-0000-0000-0000-000000000001', 'vt3');
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at, sender_id)
select '00000000-0000-0000-0000-000000000001', g, (select id from public.email_threads where gmail_thread_id = t), d, f, s, now(), :'vs'
from (values ('vm1', 'vt1', 'in', 'hello@viewtest.example', 'A note from us'),
             ('vm2', 'vt2', 'in', 'hello@viewtest.example', 'Another note'),
             ('vm3', 'vt3', 'in', 'hello@viewtest.example', 'Question'),
             ('vm4', 'vt3', 'out', 'orders@example.com', 'Re: Question')) x(g, t, d, f, s);
select public.mail_process('00000000-0000-0000-0000-000000000001', (select array_agg(id) from public.emails where gmail_id like 'vm%'), false) as processed;
select gmail_thread_id, view from public.email_threads where gmail_thread_id like 'vt%' order by 1;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select public.set_email_thread_view((select id from public.email_threads where gmail_thread_id = 'vt1'), 'offers') as others_moved;
select gmail_thread_id, view from public.email_threads where gmail_thread_id like 'vt%' order by 1;
select view_rule from public.email_senders where id = :'vs';
reset role;
