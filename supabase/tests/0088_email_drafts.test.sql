\set ON_ERROR_STOP on
\pset footer off
\echo '>>> drafts: the owner sees and changes their own; another person does not see them'
reset role;
select id as other_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and id <> '22222222-2222-2222-2222-222222222222' and role <> 'admin' limit 1 \gset
insert into public.email_drafts (organization_id, owner_id, to_emails, subject, body)
values ('00000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', array['jkane@example.com'], 'Packaging', 'Hi Jessica') returning id as d \gset
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
update public.email_drafts set body = 'Hi Jessica, updated' where id = :'d';
select subject, body from public.email_drafts where id = :'d';
select set_config('request.jwt.claims', json_build_object('sub', :'other_id', 'role', 'authenticated')::text, false);
select count(*) as others_see from public.email_drafts where id = :'d';
reset role;
