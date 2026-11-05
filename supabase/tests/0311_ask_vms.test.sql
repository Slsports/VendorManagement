\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0311: Ask VMS'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
-- the admin (1111) and a buyer (2222) from the seed; a second buyer made here
select id as admin from public.profiles where role = 'admin' and organization_id = '00000000-0000-0000-0000-000000000001' limit 1 \gset
select id as buyer from public.profiles where role <> 'admin' and organization_id = '00000000-0000-0000-0000-000000000001' and is_active order by email limit 1 \gset
update public.profiles set ask_vms = true where id = :'buyer';
insert into public.ask_chats (organization_id, owner_id, title) values ('00000000-0000-0000-0000-000000000001', :'buyer', 'Goggles') returning id as chat \gset
insert into public.ask_messages (organization_id, chat_id, role, content, cost_usd) values
  ('00000000-0000-0000-0000-000000000001', :'chat', 'user', 'How many goggles?', 0),
  ('00000000-0000-0000-0000-000000000001', :'chat', 'assistant', '502 adult goggles', 1.25),
  ('00000000-0000-0000-0000-000000000001', :'chat', 'assistant', 'yesterday', 3);
update public.ask_messages set created_at = now() - interval '2 days' where chat_id = :'chat' and content = 'yesterday';

\echo '>>> today''s spend counts today only'
select public.ask_spent_today(:'buyer') = 1.25 as spent_today;

\echo '>>> the owner reads their chat; the admin reads everyone''s'
select set_config('request.jwt.claims', json_build_object('sub', :'buyer', 'role', 'authenticated')::text, false) is not null as as_buyer;
set role authenticated;
select public.can_ask_vms() as buyer_can_ask;
select count(*) = 1 as owner_sees_chat from public.ask_chats where id = :'chat';
select count(*) = 3 as owner_sees_messages from public.ask_messages where chat_id = :'chat';
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'admin', 'role', 'authenticated')::text, false) is not null as as_admin;
set role authenticated;
select count(*) = 1 as admin_sees_chat from public.ask_chats where id = :'chat';
reset role;

\echo '>>> someone not ticked cannot ask and sees nobody else''s chats'
update public.profiles set ask_vms = false where id = :'buyer';
insert into public.ask_chats (organization_id, owner_id, title) values ('00000000-0000-0000-0000-000000000001', :'admin', 'Dana only') returning id as dchat \gset
select set_config('request.jwt.claims', json_build_object('sub', :'buyer', 'role', 'authenticated')::text, false) is not null as as_buyer2;
set role authenticated;
select not public.can_ask_vms() as not_ticked_cannot_ask;
select count(*) = 0 as cannot_see_danas from public.ask_chats where id = :'dchat';
reset role;

\echo '>>> a change request makes a task for Dana; her answer closes it and tells the person who asked'
insert into public.change_requests (organization_id, requested_by, chat_id, title, details, why)
values ('00000000-0000-0000-0000-000000000001', :'buyer', :'chat', 'Add a Need column', 'On the sales report', 'Faster ordering') returning id as cr \gset
select assigned_to = :'admin' and done_at is null as dana_task from public.tasks where auto_key = 'changereq:' || :'cr';
select set_config('request.jwt.claims', json_build_object('sub', :'buyer', 'role', 'authenticated')::text, false) is not null as as_buyer3;
set role authenticated;
do $$ begin
  perform public.change_request_decide((select id from public.change_requests where title = 'Add a Need column'), 'approved', 'x');
  raise exception 'a buyer decided';
exception when insufficient_privilege then null; end $$;
select 'buyer cannot decide' as ok;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', :'admin', 'role', 'authenticated')::text, false) is not null as as_admin2;
set role authenticated;
select public.change_request_decide(:'cr', 'declined', 'We have the Order column already')::text = '' as decided;
reset role;
select status = 'declined' and decision_note like 'We have%' as declined from public.change_requests where id = :'cr';
select done_at is not null and done_note like 'Turned down%' as dana_task_closed from public.tasks where auto_key = 'changereq:' || :'cr';
select assigned_to = :'buyer' and title like 'Your change request was turned down%' as answer_task from public.tasks where auto_key = 'changeans:' || :'cr' || ':declined';

reset role;
select set_config('request.jwt.claims', '', false) is not null as cleanup;
delete from public.tasks where auto_key in ('changereq:' || :'cr', 'changeans:' || :'cr' || ':declined');
delete from public.change_requests where id = :'cr';
delete from public.ask_chats where id in (:'chat', :'dchat');
update public.profiles set ask_vms = false where id = :'buyer';
