\set ON_ERROR_STOP on
\pset footer off
\echo '>>> "Hi <name>" puts the conversation in that person''s mail; Images folder kind'
reset role;
select id as admin_id, split_part(full_name, ' ', 1) as first from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'greet-1') returning id as th \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, received_at) values ('00000000-0000-0000-0000-000000000001', 'greet-a', :'th', 'in', now()) returning id as e1 \gset
select public.mail_apply_greeting(:'e1', upper(:'first')) = :'admin_id' as greeted;
select owner_id = :'admin_id' as owner from public.email_threads where id = :'th';
select public.mail_apply_greeting(:'e1', 'Nobodyhere') is null as unknown_name_ignored;
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path) select '00000000-0000-0000-0000-000000000001', id, 'image', 'photo', 'x/p.png' from public.vendors where name = 'Paperwork Test Co' returning kind;
