-- An invoice paid in Bill.com gets the date of Bill.com's payment, and waits until that payment is known.
begin;
select '00000000-0000-0000-0000-000000000001'::uuid as org \gset
insert into public.vendors (organization_id, name, billcom_check) values (:'org', 'Paid Date Test 0350', true) returning id as v \gset
insert into public.billcom_bills (organization_id, bill_id, vendor_name, invoice_number, invoice_date, due_date, amount, due_amount, payment_status, first_seen_at, synced_at)
values (:'org', 'bill-0350', 'Paid Date Test 0350', '350350', '2026-05-01', '2026-06-01', 100, 0, 'PAID', now(), now());
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, doc_number, doc_total, received_at)
values (:'org', :'v', 'invoice', 'inv', 'x/0350.pdf', '350350', 100, '2026-05-01') returning id as l \gset
select public.billcom_match_papers(:'org');
select set_config('t.l', :'l', false);
do $$ begin
  if (select paid_at from public.vendor_links where id = current_setting('t.l')::uuid) is not null then raise exception 'marked paid before the payment date was known'; end if;
end $$;
insert into public.vendor_payments (organization_id, source, payee, vendor_id, process_date, amount, billcom_payment_id, billcom_bill_id)
values (:'org', 'billcom', 'Paid Date Test 0350', :'v', '2026-05-20', 100, 'pay-0350', 'bill-0350');
select public.billcom_match_papers(:'org');
do $$ begin
  if (select paid_at from public.vendor_links where id = current_setting('t.l')::uuid) is distinct from '2026-05-20' then raise exception 'not the Bill.com payment date'; end if;
end $$;
rollback;
