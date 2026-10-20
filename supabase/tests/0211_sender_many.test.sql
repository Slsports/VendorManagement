\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Who is this? Rep group and vendors picked together, saved at once'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.rep_groups (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'SM211 Reps') returning id as g \gset
insert into public.rep_groups (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'SM211 Other Reps') returning id as g2 \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'SM211 LINE A') returning id as va \gset
insert into public.vendors (organization_id, name, rep_group_id) values ('00000000-0000-0000-0000-000000000001', 'SM211 LINE B', :'g2') returning id as vb \gset
insert into public.email_senders (organization_id, sender_key, is_domain, message_count) values ('00000000-0000-0000-0000-000000000001', 'sm211reps.com', true, 3) returning id as s1 \gset
insert into public.email_senders (organization_id, sender_key, is_domain, message_count) values ('00000000-0000-0000-0000-000000000001', 'sm211staff.com', true, 1) returning id as s2 \gset
insert into public.email_senders (organization_id, sender_key, is_domain, message_count) values ('00000000-0000-0000-0000-000000000001', 'sm211many.com', true, 1) returning id as s3 \gset
insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details) values ('00000000-0000-0000-0000-000000000001', 'email_sender', 'email_sender', :'s1', 'Mail from @sm211reps.com', jsonb_build_object('sender_id', :'s1')) returning id as r1 \gset
update public.email_senders set review_item_id = :'r1' where id = :'s1';

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as dana_in;
-- a rep group with two lines: the free line joins it, the one with another group stays there
select (r->'lines_added') = '["SM211 LINE A"]' and (r->'kept_with_other_group') = '["SM211 LINE B"]' as rep_group_saved
  from public.resolve_email_sender_many(:'s1', :'g', array[:'va', :'vb']::uuid[]) r;
select kind = 'rep_group' and rep_group_id = :'g' as sender_is_rep_group from public.email_senders where id = :'s1';
select (select rep_group_id from public.vendors where id = :'va') = :'g' and (select rep_group_id from public.vendors where id = :'vb') = :'g2' as lines_set;
select status = 'accepted' as card_closed from public.review_items where id = :'r1';
-- one vendor: the company's own staff; several vendors: each email by the vendor it names
select public.resolve_email_sender_many(:'s2', null, array[:'va']::uuid[]) is not null as one_vendor;
select kind = 'vendor' and vendor_id = :'va' as staff from public.email_senders where id = :'s2';
select public.resolve_email_sender_many(:'s3', null, array[:'va', :'vb']::uuid[]) is not null as many_vendors;
select kind = 'platform' as several from public.email_senders where id = :'s3';
do $$ begin
  perform public.resolve_email_sender_many((select id from public.email_senders where sender_key = 'sm211many.com'), null, '{}');
  raise exception 'saved with nothing picked';
exception when invalid_parameter_value then null; end $$;
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;

delete from public.review_items where id = :'r1';
delete from public.email_senders where id in (:'s1', :'s2', :'s3');
delete from public.activity_log where entity_id in (:'va', :'vb');
delete from public.vendors where id in (:'va', :'vb');
delete from public.rep_groups where id in (:'g', :'g2');
