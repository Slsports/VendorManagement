\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0278: billing@ conversations with a vendor or rep group go to Orders by themselves; everything else stays private'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
update public.profiles set sees_accounting = true where id = :'admin_id';
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Billing Share Vendor') returning id as v \gset
insert into public.email_senders (organization_id, sender_key, is_domain, kind, vendor_id) values ('00000000-0000-0000-0000-000000000001', 'billshare-vendor.example', true, 'vendor', :'v') returning id as sv \gset
insert into public.email_senders (organization_id, sender_key, is_domain, kind) values ('00000000-0000-0000-0000-000000000001', 'billshare-cpa.example', true, 'unknown') returning id as sc \gset
insert into public.email_senders (organization_id, sender_key, is_domain, kind) values ('00000000-0000-0000-0000-000000000001', 'billshare-truck.example', true, 'carrier') returning id as sk \gset
insert into public.mailboxes (organization_id, kind, address, label, owner_id, gmail_box, auto_share_vendor_mail)
values ('00000000-0000-0000-0000-000000000001', 'accounting', 'billing-share@example.com', 'Billing', :'admin_id', 'billing-share@example.com', true) returning id as mb \gset
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id) values
  ('00000000-0000-0000-0000-000000000001', 'bshare-vendor', :'mb'), ('00000000-0000-0000-0000-000000000001', 'bshare-cpa', :'mb'),
  ('00000000-0000-0000-0000-000000000001', 'bshare-truck', :'mb'), ('00000000-0000-0000-0000-000000000001', 'bshare-mixed', :'mb'),
  ('00000000-0000-0000-0000-000000000001', 'bshare-off', :'mb');
select id as t_vendor from public.email_threads where gmail_thread_id = 'bshare-vendor' \gset
select id as t_cpa from public.email_threads where gmail_thread_id = 'bshare-cpa' \gset
select id as t_truck from public.email_threads where gmail_thread_id = 'bshare-truck' \gset
select id as t_mixed from public.email_threads where gmail_thread_id = 'bshare-mixed' \gset
select id as t_off from public.email_threads where gmail_thread_id = 'bshare-off' \gset
update public.email_threads set auto_share_off = true where id = :'t_off';
-- the accountant wrote first in the mixed one, then the vendor
insert into public.emails (organization_id, thread_id, mailbox_id, gmail_id, direction, from_email, subject, received_at, sender_id, vendor_id) values
  ('00000000-0000-0000-0000-000000000001', :'t_cpa', :'mb', 'bshare-2', 'in', 'maggie@billshare-cpa.example', 'Estimates', now(), :'sc', null),
  ('00000000-0000-0000-0000-000000000001', :'t_truck', :'mb', 'bshare-3', 'in', 'bills@billshare-truck.example', 'Freight bill', now(), :'sk', null),
  ('00000000-0000-0000-0000-000000000001', :'t_mixed', :'mb', 'bshare-4', 'in', 'maggie@billshare-cpa.example', 'Their statement', now(), :'sc', null),
  ('00000000-0000-0000-0000-000000000001', :'t_off', :'mb', 'bshare-6', 'in', 'ar@billshare-vendor.example', 'Statement', now(), :'sv', :'v');
insert into public.emails (organization_id, thread_id, mailbox_id, gmail_id, direction, from_email, subject, received_at, sender_id, vendor_id) values
  ('00000000-0000-0000-0000-000000000001', :'t_vendor', :'mb', 'bshare-1', 'in', 'ar@billshare-vendor.example', 'Invoice 123 payment received', now(), :'sv', :'v'),
  ('00000000-0000-0000-0000-000000000001', :'t_mixed', :'mb', 'bshare-5', 'in', 'ar@billshare-vendor.example', 'Re: Their statement', now(), :'sv', :'v');
select (select shared_at is not null from public.email_threads where id = :'t_vendor') as vendor_shared,
       (select shared_at is null from public.email_threads where id = :'t_cpa') as accountant_private,
       (select shared_at is null from public.email_threads where id = :'t_truck') as freight_company_private,
       (select shared_at is null from public.email_threads where id = :'t_mixed') as mixed_private,
       (select shared_at is null from public.email_threads where id = :'t_off') as unshared_stays;
\echo '>>> the vendor email is queued for the payment reader once shared'
select exists (select 1 from public.payment_notice_candidates('00000000-0000-0000-0000-000000000001', now() - interval '1 day') c
                where c.email_id = (select id from public.emails where gmail_id = 'bshare-1')) as payment_read;

\echo '>>> Dana can share the mixed one herself; the accountant-only one is refused'
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
select count(*) as shared_by_hand from (select public.share_thread_to_orders(:'t_mixed')) x;
select shared_at is not null as mixed_now_shared from public.email_threads where id = :'t_mixed';
\set ON_ERROR_STOP off
\echo '--- sharing the accountant conversation is refused (expect an error)'
select public.share_thread_to_orders(:'t_cpa');
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select shared_at is null as accountant_still_private from public.email_threads where id = :'t_cpa';

delete from public.payment_notices where email_id in (select id from public.emails where gmail_id like 'bshare-%');
delete from public.emails where gmail_id like 'bshare-%';
delete from public.email_threads where gmail_thread_id like 'bshare-%';
delete from public.mailboxes where id = :'mb';
delete from public.email_senders where id in (:'sv', :'sc', :'sk');
delete from public.vendors where id = :'v';
