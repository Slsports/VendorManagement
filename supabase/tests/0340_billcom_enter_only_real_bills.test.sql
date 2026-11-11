-- "Enter it in Bill.com" only for real bills: not WWD invoices (by number or Edenred email), not $0, not paid, not old
-- invoices filed late. An open task on a WWD invoice closes itself as made by mistake.
begin;
select '00000000-0000-0000-0000-000000000001'::uuid as org \gset
insert into public.vendors (organization_id, name, billcom_check) values (:'org', 'Bill Test 0340', true) returning id as v \gset
insert into public.wwd_invoices (organization_id, seq, kind, vendor_id, vendor_invoice_number, paid_date)
values (:'org', 'S0340', 'invoice', :'v', '777340', '2026-10-20');
insert into public.email_threads (organization_id, gmail_thread_id) values (:'org', 'th-0340') returning id as th \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, received_at, from_email)
values (:'org', 'em-0340', :'th', 'in', now() - interval '10 days', 'noreply@edenred.com') returning id as em \gset
-- real, WWD by number, Edenred, $0, already paid, old invoice filed recently
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, doc_number, doc_date, doc_total, received_at, billcom_read_at)
values (:'org', :'v', 'invoice', 'real', 'x/1.pdf', '555340', current_date - 10, 100, current_date - 10, now()) returning id as l_real \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, doc_number, doc_date, doc_total, received_at, billcom_read_at)
values (:'org', :'v', 'invoice', 'wwd', 'x/2.pdf', '777340', current_date - 10, 100, current_date - 10, now()) returning id as l_wwd \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, doc_number, doc_date, doc_total, received_at, billcom_read_at, email_id)
values (:'org', :'v', 'invoice', 'eden', 'x/3.pdf', '888340', current_date - 10, 100, current_date - 10, now(), :'em') returning id as l_eden \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, doc_number, doc_date, doc_total, received_at, billcom_read_at)
values (:'org', :'v', 'invoice', 'zero', 'x/4.pdf', '999340', current_date - 10, 0, current_date - 10, now()) returning id as l_zero \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, doc_number, doc_date, doc_total, received_at, billcom_read_at, paid_at, paid_how)
values (:'org', :'v', 'invoice', 'paid', 'x/5.pdf', '444340', current_date - 10, 100, current_date - 10, now(), current_date - 5, 'Check') returning id as l_paid \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, doc_number, doc_date, doc_total, received_at, billcom_read_at)
values (:'org', :'v', 'invoice', 'old', 'x/6.pdf', '333340', '2024-12-15', 100, current_date - 8, now()) returning id as l_old \gset
-- an open task made under the old rule for the WWD one
insert into public.tasks (organization_id, title, assigned_to, auto_key, area)
values (:'org', 'Enter old-rule', public.org_admin(:'org'), 'billcom_enter:' || :'l_wwd', 'accounting');
select public.billcom_match_papers(:'org') as n \gset
select set_config('t.real', :'l_real', false), set_config('t.wwd', :'l_wwd', false), set_config('t.v', :'v', false);
do $$ begin
  if not exists (select 1 from public.tasks where auto_key = 'billcom_enter:' || current_setting('t.real') and done_at is null) then raise exception 'no task for a real bill'; end if;
  if (select count(*) from public.tasks t join public.vendor_links x on t.auto_key = 'billcom_enter:' || x.id
       where x.vendor_id = current_setting('t.v')::uuid and t.done_at is null) <> 1 then raise exception 'a task was made for a bill that needs none'; end if;
  if (select closed_how from public.tasks where auto_key = 'billcom_enter:' || current_setting('t.wwd')) is distinct from 'mistake' then raise exception 'the WWD task did not close as a mistake'; end if;
  if (select done_note from public.tasks where auto_key = 'billcom_enter:' || current_setting('t.wwd')) not like '%WWD invoice S0340%' then raise exception 'the WWD close does not say why'; end if;
end $$;
select public.billcom_enter_not_needed_why(:'l_eden') like '%Edenred%' as eden, public.billcom_enter_not_needed_why(:'l_zero') like '%nothing to pay%' as zero \gset
select set_config('t.ok', (:'eden' and :'zero')::text, false);
do $$ begin if not current_setting('t.ok')::boolean then raise exception 'reasons wrong'; end if; end $$;
rollback;
