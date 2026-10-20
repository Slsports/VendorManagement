\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Recent Activity: a vendor''s last emails newest first, minor ones left out, private mail kept private; the queue takes each vendor''s newest first'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into auth.users (id, email) values ('20420420-0000-0000-0000-000000000001', 'ra-a@example.com'), ('20420420-0000-0000-0000-000000000002', 'ra-b@example.com') on conflict do nothing;
insert into public.profiles (id, organization_id, email, full_name, role) values
  ('20420420-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'ra-a@example.com', 'Ra A', 'manager'),
  ('20420420-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'ra-b@example.com', 'Ra B', 'manager')
on conflict (id) do nothing;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'RA204 COTTON') returning id as v \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'RA204 OTHER') returning id as v2 \gset
insert into public.mailboxes (organization_id, kind, address, label, owner_id, gmail_box)
values ('00000000-0000-0000-0000-000000000001', 'personal', 'ra-b@example.com', 'B', '20420420-0000-0000-0000-000000000002', 'ra-b@example.com') returning id as mb \gset
insert into public.email_threads (organization_id, gmail_thread_id, vendor_id, view) values ('00000000-0000-0000-0000-000000000001', 'ra204-a', :'v', 'attention') returning id as ta \gset
-- tagged to the vendor (Worldwide or a rep group writing about it)
insert into public.email_threads (organization_id, gmail_thread_id, vendor_id, tagged_vendor_ids, view) values ('00000000-0000-0000-0000-000000000001', 'ra204-t', :'v2', array[:'v']::uuid[], 'attention') returning id as tt \gset
insert into public.email_threads (organization_id, gmail_thread_id, vendor_id, view) values ('00000000-0000-0000-0000-000000000001', 'ra204-o', :'v', 'offers') returning id as tof \gset
insert into public.email_threads (organization_id, gmail_thread_id, vendor_id, view, mailbox_id) values ('00000000-0000-0000-0000-000000000001', 'ra204-p', :'v', 'attention', :'mb') returning id as tp \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, from_name, subject, body_text, received_at, sent_by) values
  ('00000000-0000-0000-0000-000000000001', 'ra204-1', :'ta', 'out', 'orders@x.com', null, 'Kids shirts', 'Here is our order', now() - interval '5 days', '20420420-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000001', 'ra204-2', :'ta', 'in', 'rep@x.com', 'Maryellen', 'Re: Kids shirts', 'Are these sizes good?', now() - interval '4 days', null),
  ('00000000-0000-0000-0000-000000000001', 'ra204-3', :'ta', 'out', 'orders@x.com', null, 'Re: Kids shirts', 'Thanks!', now() - interval '3 days', null),
  ('00000000-0000-0000-0000-000000000001', 'ra204-4', :'tt', 'in', 'wwd@x.com', 'WWD', 'Several vendors', 'About RA204 COTTON', now() - interval '2 days', null),
  ('00000000-0000-0000-0000-000000000001', 'ra204-5', :'tof', 'in', 'promo@x.com', 'Promo', 'Sale', 'Buy now', now() - interval '1 day', null),
  ('00000000-0000-0000-0000-000000000001', 'ra204-6', :'ta', 'in', 'rep@x.com', 'Maryellen', 'Re: Kids shirts', 'Toddler 5/6', now() - interval '1 hour', null);
insert into public.emails (organization_id, gmail_id, thread_id, mailbox_id, direction, from_email, subject, body_text, received_at) values
  ('00000000-0000-0000-0000-000000000001', 'ra204-p1', :'tp', :'mb', 'in', 'rep@x.com', 'Private', 'Just for B', now() - interval '30 minutes');

-- the queue: everything unread, each vendor's newest first, Promotions left out; our sender's name comes along
select count(*) = 6 and bool_and(subject <> 'Sale') as queue_all from public.mail_activity_queue('00000000-0000-0000-0000-000000000001', 500) q where q.email_id in (select id from public.emails where gmail_id like 'ra204-%');
select sender_name is not null and sent_on is not null as sender from public.mail_activity_queue('00000000-0000-0000-0000-000000000001', 500) where subject = 'Kids shirts';

-- lines written; the thank-you is minor
update public.emails set activity_read_at = now(), activity_line = 'Line ' || gmail_id, activity_minor = (gmail_id = 'ra204-3') where gmail_id like 'ra204-%' and gmail_id <> 'ra204-6';

-- A sees orders@ mail: newest first, the unread one with no line yet, the thank-you and Promotions left out, B's private mail hidden
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"20420420-0000-0000-0000-000000000001","role":"authenticated"}', false) is not null as a_in;
select string_agg(coalesce(line, 'subject:' || subject), ' | ' order by received_at desc) = 'subject:Re: Kids shirts | Line ra204-4 | Line ra204-2 | Line ra204-1' as a_list
  from public.vendor_recent_activity(:'v');
select count(*) = 2 as limit_ok from public.vendor_recent_activity(:'v', 2);
-- B sees their own private email at the top
select set_config('request.jwt.claims', '{"sub":"20420420-0000-0000-0000-000000000002","role":"authenticated"}', false) is not null as b_in;
select (array_agg(line order by received_at desc))[1] = 'Line ra204-p1' as b_sees_private from public.vendor_recent_activity(:'v');
-- people cannot read the queue
do $$ begin
  perform public.mail_activity_queue('00000000-0000-0000-0000-000000000001', 5);
  raise exception 'person read the queue';
exception when insufficient_privilege then null; end $$;
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;

-- the queue stops at 5 lines per vendor: with 5 newer lines, an older unread email is not read
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, body_text, received_at, activity_read_at, activity_line)
select '00000000-0000-0000-0000-000000000001', 'ra204-n' || g, :'ta', 'in', 'rep@x.com', 'n', 'n', now() - interval '1 minute' * g, now(), 'n' from generate_series(1, 5) g;
update public.emails set activity_read_at = now() where gmail_id = 'ra204-6';
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, body_text, received_at) values
  ('00000000-0000-0000-0000-000000000001', 'ra204-old', :'ta', 'in', 'rep@x.com', 'Old one', 'old', now() - interval '400 days');
select not exists (select 1 from public.mail_activity_queue('00000000-0000-0000-0000-000000000001', 500) q join public.emails e on e.id = q.email_id where e.gmail_id = 'ra204-old') as stops_at_five;

delete from public.emails where gmail_id like 'ra204-%';
delete from public.email_threads where gmail_thread_id like 'ra204-%';
delete from public.mailboxes where id = :'mb';
delete from public.vendors where id in (:'v', :'v2');
