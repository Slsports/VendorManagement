\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Accounting documents: quote is a kind'
reset role;
insert into public.accounting_documents (organization_id, category, party, doc_year, file_name, kind, storage_path, sha256)
  values ('00000000-0000-0000-0000-000000000001', 'insurance', 'Cal Fair', 2026, 'q.pdf', 'quote', '00000000-0000-0000-0000-000000000001/q.pdf', 'quote-test');
select kind from public.accounting_documents where sha256 = 'quote-test';
delete from public.accounting_documents where sha256 = 'quote-test';
