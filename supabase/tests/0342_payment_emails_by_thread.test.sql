-- A payment email with no invoice numbers marks the unpaid invoices from the same conversation; with none there it asks
-- the admin which ones it paid, and that question closes itself once those invoices are paid.
begin;
select '00000000-0000-0000-0000-000000000001'::uuid as org \gset
insert into public.vendors (organization_id, name) values (:'org', 'Pay Test 0342 A') returning id as va \gset
insert into public.vendors (organization_id, name) values (:'org', 'Pay Test 0342 B') returning id as vb \gset
insert into public.email_threads (organization_id, gmail_thread_id) values (:'org', 'th-0342a') returning id as ta \gset
insert into public.email_threads (organization_id, gmail_thread_id) values (:'org', 'th-0342b') returning id as tb \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, received_at) values (:'org', 'e0342-1', :'ta', 'in', now() - interval '20 days') returning id as e_inv \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, received_at) values (:'org', 'e0342-2', :'ta', 'out', now() - interval '5 days') returning id as e_pay \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, received_at) values (:'org', 'e0342-3', :'tb', 'out', now() - interval '5 days') returning id as e_payb \gset
-- A: one invoice came earlier in the conversation, one elsewhere
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, doc_number, doc_total, received_at, email_id)
values (:'org', :'va', 'invoice', 'in thread', 'x/a1.pdf', '610342', 745, current_date - 20, :'e_inv') returning id as la \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, doc_number, doc_total, received_at)
values (:'org', :'va', 'invoice', 'elsewhere', 'x/a2.pdf', '620342', 99, current_date - 20) returning id as la2 \gset
-- B: an unpaid invoice from 30 days before, not in the conversation
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, doc_number, doc_total, received_at)
values (:'org', :'vb', 'invoice', 'b one', 'x/b1.pdf', '630342', 50, current_date - 35) returning id as lb \gset
insert into public.payment_notices (email_id, organization_id, vendor_id) values (:'e_pay', :'org', :'va'), (:'e_payb', :'org', :'vb');
select public.payment_notice_read(:'e_pay', true, current_date - 6, 'credit card by phone', '{}', false, 'paid them by phone') as na \gset
select public.payment_notice_read(:'e_payb', true, null, '', '{}', false, 'payment has been made') as nb \gset
select set_config('t.la', :'la', false), set_config('t.la2', :'la2', false), set_config('t.lb', :'lb', false),
       set_config('t.na', :'na', false), set_config('t.nb', :'nb', false), set_config('t.eb', :'e_payb', false);
do $$ begin
  if current_setting('t.na')::int <> 1 then raise exception 'the conversation''s invoice was not marked (got %)', current_setting('t.na'); end if;
  if (select paid_how from public.vendor_links where id = current_setting('t.la')::uuid) is distinct from 'credit card by phone' then raise exception 'paid how missing'; end if;
  if (select paid_at from public.vendor_links where id = current_setting('t.la2')::uuid) is not null then raise exception 'an invoice from another conversation was marked'; end if;
  if current_setting('t.nb')::int <> 0 then raise exception 'B marked something'; end if;
  if not exists (select 1 from public.tasks where auto_key = 'payask:' || current_setting('t.eb') and done_at is null and area = 'accounting') then raise exception 'no question for B'; end if;
end $$;
-- only Accounting people may answer
do $$ begin
  begin
    perform public.payment_notice_pick(current_setting('t.eb')::uuid, array[current_setting('t.lb')::uuid]);
    raise exception 'pick without Accounting access worked';
  exception when insufficient_privilege then null;
  end;
end $$;
-- B's invoice gets paid another way: the question closes itself
update public.vendor_links set paid_at = current_date, paid_how = 'Check' where id = :'lb';
do $$ begin
  if exists (select 1 from public.tasks where auto_key = 'payask:' || current_setting('t.eb') and done_at is null) then raise exception 'the question did not close'; end if;
end $$;
rollback;
