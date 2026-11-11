-- An open "Enter … in Bill.com" task for a WWD invoice still closes as made by mistake with the faster check.
begin;
select '00000000-0000-0000-0000-000000000001'::uuid as org \gset
insert into public.vendors (organization_id, name, billcom_check) values (:'org', 'Fast Test 0347', true) returning id as v \gset
insert into public.wwd_invoices (organization_id, seq, kind, vendor_id, vendor_invoice_number, paid_date) values (:'org', 'S0347', 'invoice', :'v', '770347', '2026-10-20');
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, doc_number, doc_total, received_at, billcom_read_at)
values (:'org', :'v', 'invoice', 'wwd', 'x/0347.pdf', '770347', 100, current_date - 10, now()) returning id as l \gset
insert into public.tasks (organization_id, title, assigned_to, auto_key, area) values (:'org', 'Enter 0347', public.org_admin(:'org'), 'billcom_enter:' || :'l', 'accounting');
select public.billcom_match_papers(:'org');
select set_config('t.l', :'l', false);
do $$ begin
  if (select closed_how from public.tasks where auto_key = 'billcom_enter:' || current_setting('t.l')) is distinct from 'mistake' then raise exception 'not closed'; end if;
end $$;
rollback;
