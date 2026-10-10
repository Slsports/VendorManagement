\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Approved proofs folder kind; pictures step column'
reset role;
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path) select '00000000-0000-0000-0000-000000000001', id, 'approved_proof', 'final proof', 'x/proof.pdf' from public.vendors where name = 'Paperwork Test Co' returning kind;
select count(*) >= 0 as has_column from public.emails where images_scanned_at is null;
