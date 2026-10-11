\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Personal mailboxes: only the owner and the admin see them; shared to Orders, everyone does'
reset role;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
insert into auth.users (id, email) values ('11111111-2222-3333-4444-555555555555', 'mbx-mgr@example.com') on conflict do nothing;
insert into public.profiles (id, organization_id, email, full_name, role, is_active) values ('11111111-2222-3333-4444-555555555555', '00000000-0000-0000-0000-000000000001', 'mbx-mgr@example.com', 'Morgan Test', 'manager', true) on conflict (id) do update set role = 'manager', organization_id = excluded.organization_id, is_active = true;
insert into auth.users (id, email) values ('66666666-2222-3333-4444-555555555555', 'mbx-other@example.com') on conflict do nothing;
insert into public.profiles (id, organization_id, email, full_name, role, is_active) values ('66666666-2222-3333-4444-555555555555', '00000000-0000-0000-0000-000000000001', 'mbx-other@example.com', 'Other Test', 'manager', true) on conflict (id) do update set role = 'manager', organization_id = excluded.organization_id, is_active = true;
insert into public.mailboxes (organization_id, kind, address, label, owner_id, gmail_box) values ('00000000-0000-0000-0000-000000000001', 'personal', 'morgan@example.com', 'Morgan', '11111111-2222-3333-4444-555555555555', 'morgan@example.com') returning id as mb \gset
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id, owner_id) values ('00000000-0000-0000-0000-000000000001', 'mbx-t1', :'mb', :'admin_id') returning id as th, owner_id = '11111111-2222-3333-4444-555555555555' as owner_is_mailbox_owner \gset
select :'owner_is_mailbox_owner' as owner_is_mailbox_owner;
insert into public.emails (organization_id, gmail_id, thread_id, direction, mailbox_id, gmail_box, message_id_header, received_at) values ('00000000-0000-0000-0000-000000000001', 'mbx-e1', :'th', 'in', :'mb', 'morgan@example.com', '<abc@x>', now()) returning id as e1 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, gmail_box, message_id_header, received_at) values ('00000000-0000-0000-0000-000000000001', 'mbx-e2', :'th', 'in', 'orders@example.com', '<abc@x>', now()) returning copy_of = :'e1' as second_copy_marked;
insert into public.review_items (organization_id, kind, entity_type, entity_id, title) values ('00000000-0000-0000-0000-000000000001', 'mail_reply', 'email_thread', :'th', 'private');
select count(*) as private_review_cards from public.review_items where entity_id = :'th';
update public.email_threads set owner_id = :'admin_id' where id = :'th';
select owner_id = '11111111-2222-3333-4444-555555555555' as still_owners from public.email_threads where id = :'th';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"66666666-2222-3333-4444-555555555555","role":"authenticated"}', false) is not null as as_other;
select count(*) as other_sees_threads from public.email_threads where id = :'th';
select set_config('request.jwt.claims', '{"sub":"11111111-2222-3333-4444-555555555555","role":"authenticated"}', false) is not null as as_owner;
select count(*) as owner_sees_threads, (select count(*) from public.emails where id = :'e1') as owner_sees_email from public.email_threads where id = :'th';
select public.share_thread_to_orders(:'th');
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
select count(*) as admin_sees from public.email_threads where id = :'th';
select set_config('request.jwt.claims', '{"sub":"66666666-2222-3333-4444-555555555555","role":"authenticated"}', false) is not null as as_other_again;
select count(*) as other_sees_after_share, (select count(*) from public.emails where id = :'e1') as other_sees_email from public.email_threads where id = :'th';
reset role;
