\set ON_ERROR_STOP on
\pset footer off
\echo '>>> a rep group sender: lines with no rep group join it; another group''s line and an unknown line are cards; mail is tagged and filed'
reset role;
insert into public.rep_groups (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'RL Test Reps') returning id as g \gset
insert into public.rep_groups (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'RL Other Reps') returning id as g2 \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'RL Lures') returning id as v1 \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'RL Bait') returning id as v2 \gset
insert into public.vendors (organization_id, name, rep_group_id) values ('00000000-0000-0000-0000-000000000001', 'RL Line', :'g2') returning id as v3 \gset
insert into public.email_senders (organization_id, sender_key, is_domain) values ('00000000-0000-0000-0000-000000000001', 'rltest.example', true) returning id as s \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'rlt1'), ('00000000-0000-0000-0000-000000000001', 'rlt2');
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, from_name, subject, received_at, sender_id, mentioned_vendor_ids)
values ('00000000-0000-0000-0000-000000000001', 'rlm1', (select id from public.email_threads where gmail_thread_id = 'rlt1'), 'in', 'steve@rltest.example', 'Steve Test', 'RL Lures program', now(), :'s', array[:'v1']::uuid[]),
       ('00000000-0000-0000-0000-000000000001', 'rlm2', (select id from public.email_threads where gmail_thread_id = 'rlt2'), 'in', 'steve@rltest.example', 'Steve Test', 'RL Lures and RL Bait', now(), :'s', array[:'v1', :'v2']::uuid[]);
select public.mail_apply_sender_rep(:'s', :'g', 'RL Test Reps LLC', null, null, 'signs as RL Test Reps') as filed;
select kind, rep_group_id = :'g' as to_group from public.email_senders where id = :'s';
select name, email from public.rep_group_contacts where rep_group_id = :'g';
select public.rep_group_apply_lines(:'s', array[:'v1', :'v2', :'v3']::uuid[], array['Promar Test']) as lines;
select name, rep_group_id = :'g' as in_group from public.vendors where id in (:'v1', :'v2', :'v3') order by name;
select title from public.review_items where kind = 'rep_line' and details->>'rep_group_id' = :'g' order by title;
select e.gmail_id, (select array_agg(v.name order by v.name) from public.email_vendor_tags t join public.vendors v on v.id = t.vendor_id where t.email_id = e.id) as tags,
       (select name from public.vendors where id = e.vendor_id) as filed_to
  from public.emails e where e.gmail_id like 'rlm%' order by 1;
\echo '>>> the cards: move the other group''s line, add the unknown one as a vendor'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select public.resolve_rep_line((select id from public.review_items where kind = 'rep_line' and entity_id = :'v3'), 'move') is not null as moved;
select public.resolve_rep_line((select id from public.review_items where kind = 'rep_line' and details->>'line_name' = 'Promar Test'), 'add_vendor') is not null as added;
reset role;
select name, rep_group_id = :'g' as in_group from public.vendors where name in ('RL Line', 'Promar Test') order by name;
\echo '>>> a contact''s email is enough to know the rep group'
insert into public.email_senders (organization_id, sender_key, is_domain) values ('00000000-0000-0000-0000-000000000001', 'steve@rltest.example', false) returning id as s2 \gset
update public.email_senders set kind = 'unknown' where id = :'s2';
select public.mail_match_rep_senders('00000000-0000-0000-0000-000000000001', array[:'s2']::uuid[]) as matched;
\echo '>>> a line already a vendor under a longer name is not asked about'
reset role;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'LOOSE LURES - NORTH') returning id as lv \gset
select public.rep_group_apply_lines(:'s', null, array['Loose Lures']) as lines;
select rep_group_id = :'g' as joined from public.vendors where id = :'lv';
select count(*) as cards from public.review_items where kind = 'rep_line' and details->>'line_name' = 'Loose Lures';
