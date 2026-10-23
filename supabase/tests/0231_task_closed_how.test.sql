\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Tasks: who closed it'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.tasks (organization_id, title, assigned_to, created_by) values ('00000000-0000-0000-0000-000000000001', 'CH231 a', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111') returning id as a \gset
insert into public.tasks (organization_id, title, assigned_to, created_by) values ('00000000-0000-0000-0000-000000000001', 'CH231 b', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111') returning id as b \gset
insert into public.tasks (organization_id, title, assigned_to, created_by) values ('00000000-0000-0000-0000-000000000001', 'CH231 c', '11111111-1111-1111-1111-111111111111', '11111111-1111-1111-1111-111111111111') returning id as c \gset
select closed_how is null as open_has_none from public.tasks where id = :'a';
update public.tasks set done_at = now(), done_by = '11111111-1111-1111-1111-111111111111' where id = :'a';
update public.tasks set done_at = now(), done_note = 'Paid' where id = :'b';
update public.tasks set done_at = now(), done_note = 'Closed at Dana''s request', closed_how = 'request' where id = :'c';
select (select closed_how from public.tasks where id = :'a') = 'person' and (select closed_how from public.tasks where id = :'b') = 'vms'
   and (select closed_how from public.tasks where id = :'c') = 'request' as three_kinds;
update public.tasks set done_at = null, done_by = null where id = :'a';
select closed_how is null as reopened_clears from public.tasks where id = :'a';
update public.tasks set closed_how = 'person' where id = :'b';
select closed_how = 'vms' as cannot_claim_a_person from public.tasks where id = :'b';
delete from public.tasks where id in (:'a', :'b', :'c');
