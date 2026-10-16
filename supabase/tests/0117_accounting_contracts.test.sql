\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Contracts: payment tasks 30 days ahead, start-the-renewal at the lead time, follow-ups, paid closes the task'
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
update public.profiles set sees_accounting = true where id = :'admin_id';
insert into public.accounting_contracts (organization_id, label, kind, other_party, term_start, term_end, renewal_lead_days, status, follow_up_on, follow_up_note)
  values ('00000000-0000-0000-0000-000000000001', 'SCE license 9.4763 Marina', 'license', 'Southern California Edison', current_date - 100, current_date + 400, 540, 'active', current_date + 10, 'Waiting on the DocuSign') returning id as c1 \gset
insert into public.accounting_contracts (organization_id, label, kind, other_party, term_start, term_end, status)
  values ('00000000-0000-0000-0000-000000000001', 'Far future lease', 'lease', 'Landlord', current_date, current_date + 2000, 'active') returning id as c2 \gset
insert into public.accounting_contract_payments (organization_id, contract_id, label, due_on, amount) values ('00000000-0000-0000-0000-000000000001', :'c1', '2027', current_date + 20, 52969.55) returning id as pay \gset
insert into public.accounting_contract_payments (organization_id, contract_id, label, due_on, amount) values ('00000000-0000-0000-0000-000000000001', :'c1', '2028', current_date + 385, 55000);
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
select public.accounting_sync_all_tasks('00000000-0000-0000-0000-000000000001') as tasks_made;
select title, due_date - current_date as days_out, contract_id = :'c1' as on_marina from public.tasks where area = 'accounting' and contract_id is not null order by title;
select public.accounting_sync_all_tasks('00000000-0000-0000-0000-000000000001') as second_run_makes_none;
select public.accounting_contract_payment_paid(:'pay', current_date, 'SLS checking');
select (select paid_on = current_date from public.accounting_contract_payments where id = :'pay') as paid_stamped,
       (select count(*) from public.tasks where auto_key = 'contract_payment:' || :'pay' and done_at is null) as payment_task_open;
select public.accounting_contract_followup_done(:'c1');
select (select follow_up_on is null from public.accounting_contracts where id = :'c1') as followup_cleared,
       (select count(*) from public.tasks where contract_id = :'c1' and auto_key like 'contract_followup:%' and done_at is null) as followup_task_open;
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared_2;
delete from public.tasks where area = 'accounting';
delete from public.accounting_contracts where organization_id = '00000000-0000-0000-0000-000000000001';
