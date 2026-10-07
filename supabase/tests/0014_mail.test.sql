\set ON_ERROR_STOP on
\pset footer off
\echo '>>> mail: the sync stores three WFS emails and one from a known contact; the contact links, WFS waits as one proposal'
reset role;
insert into public.mail_accounts (organization_id, mailbox, internal_domains, backfill_after)
values ('00000000-0000-0000-0000-000000000001', 'orders@example.com', array['example.com'], current_date - 365) on conflict (organization_id) do nothing;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Mail Famous Sports') returning id as wfs \gset
insert into public.vendors (organization_id, name, email) values ('00000000-0000-0000-0000-000000000001', 'Known Contact Co', 'orders@knowncontact.com') returning id as kc \gset
insert into public.email_senders (organization_id, sender_key, domain_vendor_ids) values ('00000000-0000-0000-0000-000000000001', 'mfsports.com', array[:'wfs']::uuid[]) returning id as wfs_sender \gset
insert into public.email_senders (organization_id, sender_key) values ('00000000-0000-0000-0000-000000000001', 'knowncontact.com') returning id as kc_sender \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 't-wfs-1') returning id as th1 \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 't-wfs-2') returning id as th2 \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 't-kc') returning id as th3 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at, sender_id, mentioned_vendor_ids)
values ('00000000-0000-0000-0000-000000000001', 'm1', :'th1', 'in', 'amy@mfsports.com', 'Your Mail Famous order', now() - interval '1 hour', :'wfs_sender', array[:'wfs']::uuid[]),
       ('00000000-0000-0000-0000-000000000001', 'm2', :'th2', 'in', 'amy@mfsports.com', 'Spring catalog', now() - interval '30 days', :'wfs_sender', '{}'),
       ('00000000-0000-0000-0000-000000000001', 'm3', :'th1', 'in', 'bob@mfsports.com', 'Re: Your Mail Famous order', now() - interval '10 minutes', :'wfs_sender', array[:'wfs']::uuid[]),
       ('00000000-0000-0000-0000-000000000001', 'm4', :'th3', 'in', 'orders@knowncontact.com', 'Confirmation 123', now() - interval '2 hours', :'kc_sender', '{}');
select public.mail_process('00000000-0000-0000-0000-000000000001', (select array_agg(id) from public.emails where gmail_id in ('m1','m2','m3','m4')), true) as processed;
select gmail_id, vendor_id = :'kc' as is_kc, match_how from public.emails where gmail_id in ('m1','m2','m3','m4') order by gmail_id;
\echo '>>> one review item per sender, naming the vendor with its evidence; the month-old thread starts handled'
select title, details->>'proposal_note' as why, details->>'message_count' as n from public.review_items where kind = 'email_sender' and entity_id = :'wfs_sender';
select gmail_thread_id, status, message_count from public.email_threads where id in (:'th1', :'th2', :'th3') order by gmail_thread_id;

\echo '>>> JW confirms the sender: all three emails and both threads land on the vendor; the item closes'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select public.resolve_email_sender(:'wfs_sender', 'vendor', :'wfs') as linked;
select count(*) filter (where vendor_id = :'wfs') as on_vendor, count(*) as total from public.emails where sender_id = :'wfs_sender';
select status, resolution_note from public.review_items where entity_id = :'wfs_sender';
reset role;

\echo '>>> a later message from a new address at the same company follows the sender answer; the thread owner stays put'
update public.email_threads set owner_id = '33333333-3333-3333-3333-333333333333', owner_set_at = now() where id = :'th1';
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at, sender_id)
values ('00000000-0000-0000-0000-000000000001', 'm5', :'th1', 'in', 'carl@mfsports.com', 'Re: Re: Your order', now(), :'wfs_sender');
select public.mail_process('00000000-0000-0000-0000-000000000001', (select array_agg(id) from public.emails where gmail_id = 'm5'), false) as processed;
select e.match_how, t.owner_id = '33333333-3333-3333-3333-333333333333' as owner_kept, t.status from public.emails e join public.email_threads t on t.id = e.thread_id where e.gmail_id = 'm5';

\echo '>>> marking handled sticks until a newer message arrives; a reply we send waits on the vendor with a follow-up date'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select public.set_email_thread_status(:'th1', 'handled');
reset role;
select public.mail_refresh_thread(:'th1', false);
select status from public.email_threads where id = :'th1';
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, to_emails, subject, received_at, sent_by)
values ('00000000-0000-0000-0000-000000000001', 'm6', :'th1', 'out', 'orders@example.com', array['carl@mfsports.com'], 'Re: Re: Your order', now() + interval '1 second', '22222222-2222-2222-2222-222222222222');
select public.mail_process('00000000-0000-0000-0000-000000000001', (select array_agg(id) from public.emails where gmail_id = 'm6'), false) as processed;
select status, follow_up_at::date - current_date as follow_up_in_days from public.email_threads where id = :'th1';

\echo '>>> handing over: JW gives the thread to Dana; a viewer cannot (expect 1 error)'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select public.assign_email_thread(:'th1', '11111111-1111-1111-1111-111111111111');
select owner_id = '11111111-1111-1111-1111-111111111111' as dana_owns from public.email_threads where id = :'th1';
reset role;
insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values ('66666666-6666-6666-6666-666666666666', 'viewer@example.com', '{"role":"viewer"}', '{"full_name":"Vera Viewer"}');
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}', false);
select count(*) > 0 as viewer_reads_mail from public.emails;
\set ON_ERROR_STOP off
select public.assign_email_thread(:'th1', null);
\set ON_ERROR_STOP on
reset role;
