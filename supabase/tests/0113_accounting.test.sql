\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Accounting mailbox: only people with the accounting tick see it (admin alone is not enough); never shared to Orders'
reset role;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
-- locally the admin is seeded after the migrations ran, so give the tick here (hosted: the migration gave it to Dana)
update public.profiles set sees_accounting = true where id = :'admin_id';
insert into auth.users (id, email) values ('77777777-2222-3333-4444-555555555555', 'acct-mgr@example.com') on conflict do nothing;
insert into public.profiles (id, organization_id, email, full_name, role, is_active) values ('77777777-2222-3333-4444-555555555555', '00000000-0000-0000-0000-000000000001', 'acct-mgr@example.com', 'Acct Manager', 'manager', true) on conflict (id) do update set role = 'manager', organization_id = excluded.organization_id, is_active = true, sees_accounting = false;
insert into public.mailboxes (organization_id, kind, address, label, owner_id, gmail_box, auto_share_vendor_mail) values ('00000000-0000-0000-0000-000000000001', 'accounting', 'billing-test@example.com', 'Billing', :'admin_id', 'billing-test@example.com', false) returning id as mb \gset
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id) values ('00000000-0000-0000-0000-000000000001', 'acct-t1', :'mb') returning id as th \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, mailbox_id, gmail_box, received_at) values ('00000000-0000-0000-0000-000000000001', 'acct-e1', :'th', 'in', :'mb', 'billing-test@example.com', now()) returning id as e1 \gset

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"77777777-2222-3333-4444-555555555555","role":"authenticated"}', false) is not null as as_manager;
select count(*) as manager_sees_mailbox from public.mailboxes where id = :'mb';
select count(*) as manager_sees_thread, (select count(*) from public.emails where id = :'e1') as manager_sees_email from public.email_threads where id = :'th';
\set ON_ERROR_STOP off
\echo '--- a manager cannot give themselves the tick (expect an error)'
update public.profiles set sees_accounting = true where id = '77777777-2222-3333-4444-555555555555';
\set ON_ERROR_STOP on
select sees_accounting as manager_still_without_tick from public.profiles where id = '77777777-2222-3333-4444-555555555555';

select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
select count(*) as admin_with_tick_sees from public.email_threads where id = :'th';
\set ON_ERROR_STOP off
\echo '--- sharing accounting mail to Orders is refused (expect an error)'
select public.share_thread_to_orders(:'th');
\set ON_ERROR_STOP on
select shared_at is null as still_private from public.email_threads where id = :'th';
update public.profiles set sees_accounting = true where id = '77777777-2222-3333-4444-555555555555';
update public.profiles set sees_accounting = false where id = :'admin_id';

select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin_without_tick;
select count(*) as admin_without_tick_sees_mailbox from public.mailboxes where id = :'mb';
select count(*) as admin_without_tick_sees_thread from public.email_threads where id = :'th';
select set_config('request.jwt.claims', '{"sub":"77777777-2222-3333-4444-555555555555","role":"authenticated"}', false) is not null as as_ticked_manager;
select count(*) as ticked_manager_sees_thread, (select count(*) from public.emails where id = :'e1') as ticked_manager_sees_email from public.email_threads where id = :'th';

reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared;
update public.profiles set sees_accounting = true where id = :'admin_id';
delete from public.mailboxes where id = :'mb';
delete from public.profiles where id = '77777777-2222-3333-4444-555555555555';
delete from auth.users where id = '77777777-2222-3333-4444-555555555555';
