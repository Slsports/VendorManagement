-- A reply from orders@ in a conversation with the same subject and vendor marks the staff mailbox's copy handled.
begin;
select '00000000-0000-0000-0000-000000000001'::uuid as org \gset
insert into public.vendors (organization_id, name) values (:'org', 'Rods Test 0333') returning id as v \gset
insert into public.mailboxes (organization_id, address, label, gmail_box, kind, owner_id, is_active) values (:'org', 'staff0333@shaverlakesports.com', 'Staff 0333', 'staff0333@shaverlakesports.com', 'personal', '33333333-3333-3333-3333-333333333333', true) returning id as box \gset
insert into public.email_threads (organization_id, gmail_thread_id, mailbox_id, subject, status, vendor_id, last_message_at) values (:'org', 't-0333-staff', :'box', 'RODS POWER', 'waiting_on_us', :'v', now() - interval '2 days') returning id as ts \gset
insert into public.email_threads (organization_id, gmail_thread_id, subject, status, vendor_id, last_message_at) values (:'org', 't-0333-orders', 'Fw: RODS POWER', 'handled', :'v', now()) returning id as tor \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, subject, received_at, vendor_id) values (:'org', :'tor', 'g-0333-out', 'out', 'orders@shaverlakesports.com', 'Fw: RODS POWER', now(), :'v');
select set_config('t.ts', :'ts', false);
do $$ begin
  if (select status from public.email_threads where id = current_setting('t.ts')::uuid) <> 'handled' then raise exception 'staff conversation not handled'; end if;
end $$;
rollback;
