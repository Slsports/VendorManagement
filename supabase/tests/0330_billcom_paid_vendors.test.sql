-- A vendor paid through Bill.com is checked against it; an old invoice Bill.com shows paid is marked Paid.
begin;
select '00000000-0000-0000-0000-000000000001'::uuid as org \gset
insert into public.vendors (organization_id, name) values (:'org', 'Hendrix Test 0330') returning id as v \gset
insert into public.vendor_payments (organization_id, source, payee, vendor_id, process_date, amount, billcom_payment_id, billcom_bill_id)
values (:'org', 'billcom', 'Hendrix Test 0330', :'v', '2026-06-01', 1213.50, 'pay-0330', 'bill-0330');
do $$ begin
  if not (select billcom_check from public.vendors where name = 'Hendrix Test 0330') then raise exception 'a Bill.com payment did not switch the check on'; end if;
end $$;
insert into public.billcom_bills (organization_id, bill_id, vendor_name, invoice_number, invoice_date, due_date, amount, due_amount, payment_status, first_seen_at, synced_at)
values (:'org', 'bill-0330', 'Hendrix Test 0330', '599500', '2026-05-11', '2026-06-10', 1213.50, 0, 'PAID', now(), now());
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, doc_number, doc_date, doc_total, received_at)
values (:'org', :'v', 'invoice', 'Invoice 599500', 'x/599500.pdf', '599500', '2026-05-11', 1213.50, '2026-05-11') returning id as l \gset
select public.billcom_match_papers(:'org') as matched \gset
select set_config('t.l', :'l', false);
do $$ begin
  if (select billcom_bill_id from public.vendor_links where id = current_setting('t.l')::uuid) is distinct from 'bill-0330' then raise exception 'an old invoice was not matched'; end if;
  if (select paid_how from public.vendor_links where id = current_setting('t.l')::uuid) is distinct from 'Bill.com' then raise exception 'not marked paid from Bill.com'; end if;
end $$;
rollback;
