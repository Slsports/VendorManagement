-- Every invoice with no number is read once, any vendor, any age; a vendor in Bill.com under a longer name is checked
-- when the number, amount and first word match, and its paid bill marks the invoice Paid.
begin;
select '00000000-0000-0000-0000-000000000001'::uuid as org \gset
insert into public.vendors (organization_id, name) values (:'org', 'KELLITEST''S') returning id as vk \gset
insert into public.vendors (organization_id, name) values (:'org', 'COASTTEST PET') returning id as vc \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, received_at)
values (:'org', :'vk', 'invoice', 'old, no number', 'x/k0.pdf', '2022-05-01') returning id as l_old \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, doc_number, doc_total, received_at)
values (:'org', :'vk', 'invoice', 'kelli', 'x/k1.pdf', '1587344', 2562.91, '2025-04-01') returning id as l_k \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, doc_number, doc_total, received_at)
values (:'org', :'vc', 'invoice', 'coastal', 'x/c1.pdf', '8344', 5900, '2025-04-01') returning id as l_c \gset
insert into public.billcom_bills (organization_id, bill_id, vendor_name, invoice_number, invoice_date, due_date, amount, due_amount, payment_status, first_seen_at, synced_at)
values (:'org', 'bk-0344', 'Kellitest''s Gifts', '1587344', '2025-04-01', '2025-05-01', 2562.91, 0, 'PAID', now(), now()),
       (:'org', 'bc-0344', 'Sticker Test Inc.', '8344', '2025-04-01', '2025-05-01', 5900, 0, 'PAID', now(), now());
select set_config('t.old', :'l_old', false), set_config('t.k', :'l_k', false), set_config('t.c', :'l_c', false),
       set_config('t.vk', :'vk', false), set_config('t.vc', :'vc', false), set_config('t.org', :'org', false);
do $$ begin
  if not exists (select 1 from public.billcom_papers_queue(current_setting('t.org')::uuid, 5000) q where q.id = current_setting('t.old')::uuid) then raise exception 'an old invoice with no number is not queued'; end if;
end $$;
select public.billcom_paper_read(:'l_old', '5544', null, 12.5, null, '2022-04-28');
select public.billcom_match_papers(:'org');
do $$ begin
  if (select doc_number || '|' || doc_date::text from public.vendor_links where id = current_setting('t.old')::uuid) is distinct from '5544|2022-04-28' then raise exception 'number or date not saved'; end if;
  if exists (select 1 from public.billcom_papers_queue(current_setting('t.org')::uuid, 5000) q where q.id = current_setting('t.old')::uuid) then raise exception 'read twice'; end if;
  if not (select billcom_check from public.vendors where id = current_setting('t.vk')::uuid) then raise exception 'Kelli''s not checked'; end if;
  if (select billcom_check from public.vendors where id = current_setting('t.vc')::uuid) then raise exception 'a different name was checked'; end if;
  if (select paid_how from public.vendor_links where id = current_setting('t.k')::uuid) is distinct from 'Bill.com' then raise exception 'Kelli''s invoice not paid'; end if;
  if (select paid_at from public.vendor_links where id = current_setting('t.c')::uuid) is not null then raise exception 'Coastal marked'; end if;
end $$;
rollback;
