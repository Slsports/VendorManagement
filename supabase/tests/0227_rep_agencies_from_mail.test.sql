\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Rep agencies from mail: every vendor named, New rep group, name card, another name re-checks the old'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.rep_groups (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'RA227 Other Reps') returning id as g2 \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'RA227 REEF') returning id as va \gset
insert into public.vendors (organization_id, name, rep_group_id) values ('00000000-0000-0000-0000-000000000001', 'RA227 SPIN', :'g2') returning id as vb \gset
insert into public.email_senders (organization_id, sender_key, is_domain, display_name) values ('00000000-0000-0000-0000-000000000001', 'ra227reps.com', true, 'Jeff RA') returning id as s \gset
insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at) values ('00000000-0000-0000-0000-000000000001', 'ra227', 'Show specials', now()) returning id as t \gset
-- 6 emails: REEF named in 4, SPIN in 3
insert into public.emails (organization_id, thread_id, gmail_id, sender_id, direction, from_email, subject, body_text, received_at, mentioned_vendor_ids)
select '00000000-0000-0000-0000-000000000001', :'t', 'ra227-' || i, :'s', 'in', 'jeff@ra227reps.com', 'Show specials ' || i, 'Lines we carry', now() - (i || ' days')::interval,
       case when i <= 4 and i >= 3 then array[:'va', :'vb']::uuid[] when i <= 2 then array[:'va']::uuid[] when i = 5 then array[:'vb']::uuid[] else '{}' end
  from generate_series(1, 6) i;
select count(*) = 1 as refreshed from (select public.mail_refresh_sender(:'s')) x;
select r.title like '%names 2 of our vendors%' and jsonb_array_length(r.details->'named_vendors') = 2 and s.proposed_vendor_id is null
       and (r.details->'named_vendors'->0->>'name') = 'RA227 REEF' and (r.details->'named_vendors'->0->>'n')::int = 4
  as all_named_no_single_guess
  from public.email_senders s join public.review_items r on r.id = s.review_item_id where s.id = :'s';
-- Claude: a rep agency that is not in Rep Groups, with its people
select public.mail_apply_sender_sort(:'s', 'rep_group', null, 'RA227 Turner Group', 'ra227reps.com', '555-0100', 'Rep agency for REEF and SPIN',
       '[{"name":"Jeff RA","email":"jeff@ra227reps.com","phone":"555-0101","title":"Owner"}]') = 'unsure' as sorted;
select s.ai_kind = 'rep_group' and jsonb_array_length(s.rep_contacts) = 1 and r.title like '%RA227 Turner Group, a rep agency%' and r.details->>'company' = 'RA227 Turner Group'
  as agency_on_card from public.email_senders s join public.review_items r on r.id = s.review_item_id where s.id = :'s';
select review_item_id as card from public.email_senders where id = :'s' \gset

-- a viewer cannot make a rep group
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', false) is not null as viewer_in;
set role authenticated;
do $$ begin
  perform public.rep_group_from_sender((select id from public.email_senders where sender_key = 'ra227reps.com'), 'X', null, null, '[]', '{}');
  raise exception 'viewer made a rep group';
exception when insufficient_privilege then null; end $$;
reset role;

-- Dana: New rep group, its person, both lines
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as dana_in;
set role authenticated;
select (r->>'created')::boolean and (r->>'people')::int = 1 and (r->'lines_added') = '["RA227 REEF"]' and (r->>'asked')::int = 1 and (r->>'tagged')::int = 5
  as rep_group_made from public.rep_group_from_sender(:'s', 'RA227 Turner Group', 'ra227reps.com', '555-0100',
       '[{"name":"Jeff RA","email":"Jeff@ra227reps.com","phone":"555-0101","title":"Owner"},{"name":"","email":""}]', array[:'va', :'vb']::uuid[]) r;
reset role;
select id as g from public.rep_groups where name = 'RA227 Turner Group' \gset
select count(*) = 1 as one_group from public.rep_groups where lower(name) = 'ra227 turner group';
select (select count(*) from public.rep_group_contacts where rep_group_id = :'g' and email = 'jeff@ra227reps.com') = 1 as person_saved;
select kind = 'rep_group' and rep_group_id = :'g' and rep_lines_read_at is null as sender_filed from public.email_senders where id = :'s';
select (select rep_group_id from public.vendors where id = :'va') = :'g' and (select rep_group_id from public.vendors where id = :'vb') = :'g2' as lines_set;
select count(*) = 1 as move_card from public.review_items where kind = 'rep_line' and entity_id = :'vb' and status = 'pending';
select (select count(*) from public.email_vendor_tags g join public.emails e on e.id = g.email_id where e.sender_id = :'s' and g.vendor_id = :'va') = 4
   and (select count(*) from public.email_vendor_tags g join public.emails e on e.id = g.email_id where e.sender_id = :'s' and g.vendor_id = :'vb') = 3 as every_email_tagged;
select status = 'accepted' as card_closed from public.review_items where id = :'card';

-- a name that does not belong: the card removes it
reset role;
update public.vendors set aliases = array['RA227 AGENCY', 'RA227 KEEP'] where id = :'va';
insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
values ('00000000-0000-0000-0000-000000000001', 'vendor_alias', 'vendor', :'va', 'RA227 AGENCY?', jsonb_build_object('vendor_id', :'va', 'vendor_name', 'RA227 REEF', 'alias', 'ra227 agency')) returning id as ac \gset
set role authenticated;
select count(*) = 1 as answered from (select public.vendor_alias_answer(:'ac', true)) x;
reset role;
select aliases = array['RA227 KEEP'] as alias_removed from public.vendors where id = :'va';
select status = 'accepted' as alias_card_closed from public.review_items where id = :'ac';

-- another name queues a re-check; the re-check names old mail, tags it and updates rep line cards
select count(*) >= 2 and bool_or('RA227 AGENCY' = any (removed)) as name_changes_queued from public.vendor_name_checks where vendor_id = :'va';
delete from public.vendor_name_checks where vendor_id = :'va';
insert into public.emails (organization_id, thread_id, gmail_id, sender_id, direction, from_email, subject, body_text, received_at)
values ('00000000-0000-0000-0000-000000000001', :'t', 'ra227-x', :'s', 'in', 'jeff@ra227reps.com', 'New line', 'We now carry Sunny Pals swim toys', now()) returning id as ex \gset
insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
values ('00000000-0000-0000-0000-000000000001', 'rep_line', 'rep_group', :'g', 'RA227 reps Sunny Pals', jsonb_build_object('rep_group_id', :'g', 'rep_group_name', 'RA227 Turner Group', 'line_name', 'Sunny Pals', 'sender_id', :'s')) returning id as rl \gset
update public.vendors set aliases = aliases || array['SUNNY PALS - WWD'] where id = :'va';
select added = array['SUNNY PALS - WWD'] and status = 'waiting' as alias_queued from public.vendor_name_checks where vendor_id = :'va';
select count(*) = 1 and bool_and(check_id is not null) as claimed from public.vendor_name_check_next('00000000-0000-0000-0000-000000000001');
select id as nc from public.vendor_name_checks where vendor_id = :'va' \gset
select count(*) = 1 and bool_and(id = :'ex') as found_by_phrase from public.vendor_name_check_emails('00000000-0000-0000-0000-000000000001', :'va', 'sunny pals', false);
select (public.vendor_name_check_apply(:'nc', array[:'ex']::uuid[], '{}')->>'named')::int = 1 as named;
select :'va' = any (mentioned_vendor_ids) as mail_names_it from public.emails where id = :'ex';
select count(*) = 1 as tagged_as_rep_mail from public.email_vendor_tags where email_id = :'ex' and vendor_id = :'va';
select count(*) = 1 as finished from (select public.vendor_name_check_finish(:'nc', array['sunny pals'], '{}', null)) x;
select details->>'vendor_id' = :'va' and title like '%which is our vendor RA227 REEF%' as rep_line_matched from public.review_items where id = :'rl';
select status = 'done' and emails_named = 1 and emails_tagged = 1 and cards_updated = 1 as counts from public.vendor_name_checks where id = :'nc';
-- a removed name: mail that named it only by that name no longer does
select (public.vendor_name_check_apply(:'nc', '{}', array[:'ex']::uuid[])->>'unnamed')::int = 1 as unnamed;
select not (:'va' = any (mentioned_vendor_ids)) and not exists (select 1 from public.email_vendor_tags where email_id = :'ex' and vendor_id = :'va') as untagged from public.emails where id = :'ex';
select public.name_words('Thin Air Brands, LLC & Co''s') = 'thin air brands llc and cos' as words;

delete from public.review_items where entity_id in (:'va', :'vb', :'g', :'s') or id in (:'card', :'rl', :'ac');
delete from public.email_vendor_tags where email_id in (select id from public.emails where thread_id = :'t');
delete from public.emails where thread_id = :'t';
delete from public.email_threads where id = :'t';
update public.email_senders set review_item_id = null where id = :'s';
delete from public.email_senders where id = :'s';
delete from public.activity_log where entity_id in (:'va', :'vb', :'g');
delete from public.vendor_name_checks where vendor_id in (:'va', :'vb');
delete from public.rep_group_contacts where rep_group_id = :'g';
delete from public.vendors where id in (:'va', :'vb');
delete from public.rep_groups where id in (:'g', :'g2');
