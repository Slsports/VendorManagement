\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Proof and credit tasks carry the email the file came in on (Orders mail only)'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'DT206 COTTON') returning id as v \gset
insert into public.mailboxes (organization_id, kind, address, label, owner_id, gmail_box)
values ('00000000-0000-0000-0000-000000000001', 'personal', 'dt206@example.com', 'P', '11111111-1111-1111-1111-111111111111', 'dt206@example.com') returning id as mb \gset
insert into public.email_threads (organization_id, gmail_thread_id, vendor_id) values ('00000000-0000-0000-0000-000000000001', 'dt206-o', :'v') returning id as t_orders \gset
insert into public.email_threads (organization_id, gmail_thread_id, vendor_id, mailbox_id) values ('00000000-0000-0000-0000-000000000001', 'dt206-p', :'v', :'mb') returning id as t_priv \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at) values ('00000000-0000-0000-0000-000000000001', 'dt206-1', :'t_orders', 'in', 'a@x.com', 'Proof', now()) returning id as e1 \gset
insert into public.emails (organization_id, gmail_id, thread_id, mailbox_id, direction, from_email, subject, received_at) values ('00000000-0000-0000-0000-000000000001', 'dt206-2', :'t_priv', :'mb', 'in', 'a@x.com', 'Private proof', now()) returning id as e2 \gset

insert into public.vendor_links (organization_id, vendor_id, kind, label, url, email_id) values ('00000000-0000-0000-0000-000000000001', :'v', 'proof', 'P1', 'https://example.com/p1.png', :'e1') returning id as l1 \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url, email_id) values ('00000000-0000-0000-0000-000000000001', :'v', 'proof', 'P2', 'https://example.com/p2.png', :'e2') returning id as l2 \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url, email_id) values ('00000000-0000-0000-0000-000000000001', :'v', 'credit', 'C1', 'https://example.com/c1.pdf', :'e1') returning id as l3 \gset

select thread_id = :'t_orders' and notes like 'Click Go to it%' as proof_has_email from public.tasks where auto_key = 'proof:' || :'l1';
select thread_id is null as private_stays_private from public.tasks where auto_key = 'proof:' || :'l2';
select thread_id = :'t_orders' as credit_has_email from public.tasks where auto_key = 'credit:' || :'l3';

delete from public.vendor_links where id in (:'l1', :'l2', :'l3');
select count(*) = 0 as tasks_gone from public.tasks where auto_key in ('proof:' || :'l1', 'proof:' || :'l2', 'credit:' || :'l3');
delete from public.emails where gmail_id like 'dt206-%';
delete from public.email_threads where gmail_thread_id like 'dt206-%';
delete from public.mailboxes where id = :'mb';
delete from public.vendors where id = :'v';
