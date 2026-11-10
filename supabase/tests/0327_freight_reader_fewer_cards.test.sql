\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0327: fewer, truer freight cards'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'FR327 SPORTS') returning id as v \gset
insert into public.email_threads (organization_id, gmail_thread_id, subject, vendor_id) values ('00000000-0000-0000-0000-000000000001', 'fr327-t1', 'Order', :'v') returning id as t1 \gset
insert into public.email_threads (organization_id, gmail_thread_id, subject, vendor_id) values ('00000000-0000-0000-0000-000000000001', 'fr327-t2', 'Fwd: Order', :'v') returning id as t2 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, to_emails, subject, received_at, vendor_id)
  values ('00000000-0000-0000-0000-000000000001', 'fr327-e1', :'t1', 'in', 'rep@fr327.example', array['orders@example.com'], 'Order', now() - interval '2 days', :'v') returning id as e1 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, to_emails, subject, received_at, vendor_id)
  values ('00000000-0000-0000-0000-000000000001', 'fr327-e2', :'t2', 'out', 'orders@example.com', array['rep@fr327.example'], 'Fwd: Order', now() - interval '1 day', :'v') returning id as e2 \gset

-- one sentence read two ways: one card; "36 pairs" is not $36; $0.00 is no amount
select public.freight_promises_save(:'e1', '[
  {"terms":"free","po":"FR-1","said_by":"vendor","quote":"You have already met the $2,000 freight minimum."},
  {"terms":"free_over","po":"FR-1","free_over":2000,"said_by":"vendor","quote":"You have already met the $2,000 freight minimum."},
  {"terms":"free_over","free_over":36,"said_by":"vendor","quote":"36 pairs and free freight"},
  {"terms":"charged","po":"FR-2","amount":0,"said_by":"vendor","quote":"Freight is on you for FR-2."}
]') = 2 as two_kept;
select amount is null as zero_is_no_amount from public.freight_promises where email_id = :'e1' and terms = 'charged';

-- our own carrier price is not their quote; the same words forwarded in another conversation make no second card
select public.freight_promises_save(:'e2', '[
  {"terms":"quoted","amount":1602.46,"said_by":"us","quote":"TForce Freight: $1,602.46"},
  {"terms":"free","po":"FR-1","said_by":"vendor","quote":"You have already met the  $2,000 freight minimum."}
]') = 0 as none_from_forward;

delete from public.review_items where entity_id in (select id from public.freight_promises where vendor_id = :'v');
delete from public.freight_promises where vendor_id = :'v';
delete from public.email_threads where id in (:'t1', :'t2');
delete from public.vendors where id = :'v';
