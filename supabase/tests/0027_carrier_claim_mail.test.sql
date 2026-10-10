\set ON_ERROR_STOP on
\pset footer off
\echo '>>> a carrier added later claims its undecided senders (not ones already answered) and their threads'
reset role;
select set_config('request.jwt.claims', '', false) is not null as as_service;
insert into public.email_senders (organization_id, sender_key, is_domain) values ('00000000-0000-0000-0000-000000000001', 'newltl.example', true) returning id as ns \gset
insert into public.email_senders (organization_id, sender_key, is_domain, kind) values ('00000000-0000-0000-0000-000000000001', 'billing@other.newltl.example', false, 'not_vendor') returning id as ns2 \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'nlt1') returning id as nt \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at, sender_id)
values ('00000000-0000-0000-0000-000000000001', 'nlm1', :'nt', 'in', 'pod@newltl.example', 'Delivery Receipt for 1', now(), :'ns');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
insert into public.carriers (organization_id, name, mode, email_domains, owner_id) values ('00000000-0000-0000-0000-000000000001', 'New LTL', 'ltl', '{newltl.example}', '33333333-3333-3333-3333-333333333333') returning id as nc \gset
select public.carrier_claim_mail(:'nc') as claimed;
reset role;
select kind, carrier_id = :'nc' as is_carrier from public.email_senders where id = :'ns';
select kind from public.email_senders where id = :'ns2';
select carrier_id = :'nc' as freight_thread, owner_id = '33333333-3333-3333-3333-333333333333'::uuid as to_owner from public.email_threads where id = :'nt';
\echo '>>> a viewer cannot (expect 1 error)'
\set ON_ERROR_STOP off
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', false);
select public.carrier_claim_mail(:'nc');
\set ON_ERROR_STOP on
reset role;
