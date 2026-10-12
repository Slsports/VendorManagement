\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Primary/Promotions: a mass-mailed offer with a "statement" goes to Promotions; Other senders'' ads too; a rep''s own mail stays'
reset role;
select public.mail_view_for('in', '{}', 'New Arrivals That Make a Statement', true, null, null, null, false) as statement_ad,
       public.mail_view_for('in', '{}', 'Your statement for September', true, null, null, null, false) as statement,
       public.mail_view_for('in', '{}', 'Join our webinar', true, null, 'attention', 'not_vendor', false) as other_ad,
       public.mail_view_for('in', '{}', 'Your account', false, null, 'attention', 'not_vendor', false) as other_note,
       public.mail_view_for('in', '{}', 'Show special for you', false, null, null, 'rep_group', false) as rep_offer,
       public.mail_view_for('in', '{}', 'Checking in', false, null, null, 'rep_group', false, 'attention') as rep_note,
       public.mail_view_for('in', '{}', 'Hello', false, null, 'offers', 'marketing', false) as marketing,
       public.mail_view_for('in', '{}', 'Hello', false, null, 'offers', 'marketing', true) as marketing_we_wrote;
\echo '>>> moving a promo teaches that address and kind only: the same address''s regular mail and another address stay in Primary'
insert into public.email_senders (organization_id, sender_key, is_domain) values ('00000000-0000-0000-0000-000000000001', 'pp.example', true) returning id as ps \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'pp1'), ('00000000-0000-0000-0000-000000000001', 'pp2'), ('00000000-0000-0000-0000-000000000001', 'pp3'), ('00000000-0000-0000-0000-000000000001', 'pp4');
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at, sender_id, is_bulk)
select '00000000-0000-0000-0000-000000000001', g, (select id from public.email_threads where gmail_thread_id = t), 'in', f, s, now(), :'ps', b
from (values ('ppm1', 'pp1', 'news@pp.example', 'Hello from us', true),
             ('ppm2', 'pp2', 'news@pp.example', 'Another hello', true),
             ('ppm3', 'pp3', 'News@pp.example', 'About your account', false),
             ('ppm4', 'pp4', 'rep@pp.example', 'Weekly hello', true)) x(g, t, f, s, b);
select public.mail_process('00000000-0000-0000-0000-000000000001', (select array_agg(id) from public.emails where gmail_id like 'ppm%'), false) as processed;
update public.emails set view = 'attention', view_how = 'signals' where gmail_id like 'ppm%';
update public.email_threads set view = 'attention' where gmail_thread_id like 'pp%';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select public.set_email_thread_view((select id from public.email_threads where gmail_thread_id = 'pp1'), 'offers') as others_moved;
select gmail_thread_id, view from public.email_threads where gmail_thread_id like 'pp%' order by 1;
select address, mail_kind, view, mailbox_id is null as every_inbox from public.mail_address_rules where address like '%pp.example';
reset role;
