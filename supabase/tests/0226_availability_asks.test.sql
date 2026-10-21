\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Ask the rep what is discontinued: ask, send, reply, read, review card'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'ASK226') returning id as v \gset
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as dana;
set role authenticated;
select public.availability_ask_create(:'v', null, '[{"vid":"A1","name":"Bellies Bear","qty":6},{"vid":"B2","name":"Boos Cat","qty":6}]') as ask \gset
select status = 'draft' and created_by = '11111111-1111-1111-1111-111111111111' as drafted from public.availability_asks where id = :'ask';
reset role;
select set_config('request.jwt.claims', '', false) is not null as service2;
insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at) values ('00000000-0000-0000-0000-000000000001', 'ask226', 'Can we still order these?', now()) returning id as t \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, body_text, received_at)
  values ('00000000-0000-0000-0000-000000000001', :'t', 'ask226-out', 'out', 'orders@shaverlakesports.com', array['rep@ask226.test'], 'Can we still order these?', 'A1, B2', now() - interval '1 hour') returning id as out_email \gset
select public.availability_ask_sent(:'ask', :'out_email') is null as stamped;
select status = 'sent' and thread_id = :'t' as waiting from public.availability_asks where id = :'ask';
select count(*) = 0 as nothing_until_reply from public.availability_ask_next();
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, body_text, received_at)
  values ('00000000-0000-0000-0000-000000000001', :'t', 'ask226-in', 'in', 'rep@ask226.test', array['orders@shaverlakesports.com'], 'RE: Can we still order these?', 'A1 is fine, B2 is discontinued', now()) returning id as reply \gset
select count(*) = 1 and bool_and(ask_id = :'ask') as reply_found from public.availability_ask_next();
select count(*) = 0 as claimed from public.availability_ask_next();
select public.availability_ask_read(:'ask', :'reply', '[{"vid":"A1","name":"Bellies Bear","status":"available"},{"vid":"B2","name":"Boos Cat","status":"discontinued","rep_words":"B2 is discontinued","sure":true}]') = 1 as one_change;
select count(*) = 1 and bool_and(c.source = 'rep_reply' and c.read_as = 'discontinued' and r.assigned_to = '11111111-1111-1111-1111-111111111111' and r.details->>'reply_email_id' = :'reply')
  as card_for_asker from public.item_changes c join public.review_items r on r.id = c.review_item_id where c.ask_id = :'ask';
select status = 'read' and jsonb_array_length(answers) = 2 as answers_kept from public.availability_asks where id = :'ask';
update public.item_changes set decision = 'discontinued' where ask_id = :'ask';
select public.availability_ask_read(:'ask', :'reply', '[{"vid":"B2","name":"Boos Cat","status":"out_of_stock"}]') = 0 as decision_kept;
select read_as = 'discontinued' as unchanged from public.item_changes where ask_id = :'ask';
delete from public.review_items where entity_id = :'v';
delete from public.availability_asks where id = :'ask';
delete from public.emails where thread_id = :'t';
delete from public.email_threads where id = :'t';
delete from public.vendors where id = :'v';
