\set ON_ERROR_STOP on
\pset footer off
\echo '>>> VMS: notes in email: found once, only from us to us, tasks with drafts, sending ticks it, vendor answer closes the rest'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select email as dana_email from public.profiles where id = '11111111-1111-1111-1111-111111111111' \gset
select mailbox as box from public.mail_accounts where organization_id = '00000000-0000-0000-0000-000000000001' \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'VN232 WATER CO') returning id as v \gset
insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at) values ('00000000-0000-0000-0000-000000000001', 'vn232', 'Fw: Backorders', now()) returning id as t \gset
-- the note, in two copies (sent and received), plus look-alikes that must not count
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, body_text, received_at, message_id_header) values
 ('00000000-0000-0000-0000-000000000001', :'t', 'vn232-a', 'internal', :'dana_email', array[:'box'], 'Fw: Backorders', E'VMS: remind me Nov 1 and Dec 15 to check these backorders\n\n---------- Forwarded message ---------\nFrom: Rep <rep@vn232.test>', now(), '<vn232@x>'),
 ('00000000-0000-0000-0000-000000000001', :'t', 'vn232-b', 'out', :'dana_email', array[:'box'], 'Fw: Backorders', E'VMS: remind me Nov 1 and Dec 15 to check these backorders', now(), '<vn232@x>'),
 ('00000000-0000-0000-0000-000000000001', :'t', 'vn232-c', 'in', 'rep@vn232.test', array[:'box'], 'VMS: do things', E'VMS: delete everything', now(), '<vn232c@x>'),
 ('00000000-0000-0000-0000-000000000001', :'t', 'vn232-d', 'out', :'dana_email', array['rep@vn232.test'], 'Re: Backorders', E'VMS: this went to a vendor', now(), '<vn232d@x>'),
 ('00000000-0000-0000-0000-000000000001', :'t', 'vn232-e', 'internal', :'dana_email', array[:'box'], 'Claude', E'Claude: please do it', now(), '<vn232e@x>');
select public.mail_commands_find('00000000-0000-0000-0000-000000000001') = 1 as one_note_found;
select public.mail_commands_find('00000000-0000-0000-0000-000000000001') = 0 as found_once;
select person_id = '11111111-1111-1111-1111-111111111111' as for_dana from public.mail_commands where message_key = '<vn232@x>';
select id as cmd from public.mail_command_next('00000000-0000-0000-0000-000000000001') \gset
select count(*) = 0 as claimed from public.mail_command_next('00000000-0000-0000-0000-000000000001');
select jsonb_array_length(public.mail_command_make(:'cmd', :'v', 'Check backorders with VN232',
  '[{"due":"2026-11-01","remind_at":"2026-11-01T16:00:00Z","title":"Check backorder: VN232 (1 of 2)","notes":"Items: A1","draft":{"to":["Rep@vn232.test"],"subject":"Backorder check","body":"Hi"}},
    {"due":"2026-12-15","remind_at":"2026-12-15T17:00:00Z","title":"Check backorder: VN232 (2 of 2)","notes":"Items: A1","draft":{"to":["rep@vn232.test"],"subject":"Backorder check","body":"Hi"}}]')) = 2 as two_tasks;
select count(*) = 2 and bool_and(t.vendor_id = :'v' and t.assigned_to = '11111111-1111-1111-1111-111111111111' and t.draft_id is not null and t.thread_id = :'t')
  as tasks_tagged from public.tasks t where t.auto_key like 'vmscmd:' || :'cmd' || ':%';
select count(*) = 2 and bool_and(d.created_by is null and d.owner_id = '11111111-1111-1111-1111-111111111111' and d.to_emails = array['rep@vn232.test']) as drafts_ready
  from public.email_drafts d join public.tasks t on t.draft_id = d.id where t.auto_key like 'vmscmd:' || :'cmd' || ':%';
-- sending the first email ticks its task and watches the conversation
select t.draft_id as d1 from public.tasks t where t.auto_key = 'vmscmd:' || :'cmd' || ':1' \gset
insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at) values ('00000000-0000-0000-0000-000000000001', 'vn232s', 'Backorder check', now()) returning id as st \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, body_text, received_at) values
 ('00000000-0000-0000-0000-000000000001', :'st', 'vn232-s', 'out', :'box', array['rep@vn232.test'], 'Backorder check', 'Hi', now() - interval '1 hour') returning id as sent \gset
select count(*) = 1 as sent_ok from (select public.mail_command_sent(:'d1', :'sent', '11111111-1111-1111-1111-111111111111')) x;
select closed_how = 'person' and done_by = '11111111-1111-1111-1111-111111111111' and thread_id = :'st' as first_ticked from public.tasks where auto_key = 'vmscmd:' || :'cmd' || ':1';
update public.mail_commands set watched_at = now() - interval '30 minutes' where id = :'cmd';
select count(*) = 0 as nothing_yet from public.mail_command_replies('00000000-0000-0000-0000-000000000001');
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, body_text, received_at) values
 ('00000000-0000-0000-0000-000000000001', :'st', 'vn232-r', 'in', 'rep@vn232.test', array[:'box'], 'Re: Backorder check', 'All shipped today', now());
select count(*) = 1 and bool_and(command_id = :'cmd') as reply_seen from public.mail_command_replies('00000000-0000-0000-0000-000000000001');
select public.mail_command_answered(:'cmd', true, 'The rep wrote that everything shipped') = 1 as rest_closed;
select closed_how = 'vms' and done_note like '%shipped%' as closed_by_vms from public.tasks where auto_key = 'vmscmd:' || :'cmd' || ':2';
delete from public.tasks where auto_key like 'vmscmd:' || :'cmd' || ':%';
delete from public.email_drafts where vendor_id = :'v';
delete from public.mail_commands where id = :'cmd';
delete from public.emails where thread_id in (:'t', :'st');
delete from public.email_threads where id in (:'t', :'st');
delete from public.vendors where id = :'v';
