\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Accounting documents: names by the convention, no duplicate bytes, folders, Accounting tick only'
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
update public.profiles set sees_accounting = true where id = :'admin_id';
-- the convention: whole dollars, cents when paid, abbreviations as given, no dash
select public.accounting_document_name('2026-09-25', 'P&S', 'Cal Fair', 'COM 0301476591', 'SLS Building', 4472.00, 'paid', 'pdf') as cal_fair;
select public.accounting_document_name('2026-10-14', 'GS', 'SCE', '9.4764', 'License 2028-2032', null, 'executed', 'PDF') as sce;
select public.accounting_document_name('2026-01-05', 'SLS', 'Suburban Propane', '', 'Statement', 6045.31, '', 'pdf') as cents_kept;
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'admin_id', 'role', 'authenticated')::text, false) is not null as as_admin;
insert into public.accounting_documents (organization_id, category, party, doc_year, file_name, kind, whose, doc_date, number, what, amount, status_word, storage_path, sha256, size)
  values ('00000000-0000-0000-0000-000000000001', 'insurance', 'Cal Fair', 2026, '2026-09-25 P&S Cal Fair COM 0301476591 SLS Building $4472 paid.pdf', 'invoice', 'P&S', '2026-09-25', 'COM 0301476591', 'SLS Building', 4472, 'paid', '00000000-0000-0000-0000-000000000001/a.pdf', 'abc', 10)
  returning id as d1 \gset
-- the same bytes again are refused (one document, however often it arrives)
do $$ begin
  insert into public.accounting_documents (organization_id, category, party, doc_year, file_name, storage_path, sha256)
    values ('00000000-0000-0000-0000-000000000001', 'bills', 'Again', 2026, 'x.pdf', '00000000-0000-0000-0000-000000000001/b.pdf', 'abc');
  raise exception 'duplicate bytes were accepted';
exception when unique_violation then null; end $$;
-- editing the facts renames by the convention; typing a name keeps it
update public.accounting_documents set amount = 4472.50, status_word = '' where id = :'d1';
select file_name as renamed_from_facts from public.accounting_documents where id = :'d1';
update public.accounting_documents set file_name = 'My own name.pdf', amount = 1 where id = :'d1';
select file_name as typed_name_kept from public.accounting_documents where id = :'d1';
insert into public.accounting_documents (organization_id, category, party, doc_year, file_name, storage_path, sha256, status)
  values ('00000000-0000-0000-0000-000000000001', 'insurance', 'Cal Fair', 2025, 'old.pdf', '00000000-0000-0000-0000-000000000001/c.pdf', 'def', 'review');
select category, party, doc_year, n, review_n from public.accounting_document_folders('00000000-0000-0000-0000-000000000001') order by doc_year desc;
-- without the tick: nothing
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000d0c1', 'docs-test@example.com') on conflict do nothing;
insert into public.profiles (id, organization_id, email, full_name, role, is_active)
  values ('00000000-0000-0000-0000-00000000d0c1', '00000000-0000-0000-0000-000000000001', 'docs-test@example.com', 'Docs Test', 'manager', true)
  on conflict (id) do update set role = 'manager', is_active = true, sees_accounting = false;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000d0c1","role":"authenticated"}', false) is not null as as_manager;
select count(*) as manager_sees_none from public.accounting_documents;
reset role;
select set_config('request.jwt.claims', '', false) is not null as claims_cleared;
delete from public.accounting_documents where organization_id = '00000000-0000-0000-0000-000000000001';
delete from public.profiles where id = '00000000-0000-0000-0000-00000000d0c1';
delete from auth.users where id = '00000000-0000-0000-0000-00000000d0c1';
