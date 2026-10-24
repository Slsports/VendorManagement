\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Rossignol invoices carry their numbers'
reset role;
select count(*) = 0 as none_missing from public.vendor_links where vendor_id = '37dd4e44-b4fb-4d7a-934f-eee6b76d8ea6' and kind = 'invoice' and doc_number is null and label ~ '^Invoice_\d{9,}';
