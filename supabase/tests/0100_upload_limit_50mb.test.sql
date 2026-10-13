\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Vendor files take up to 50 MB'
reset role;
select file_size_limit from storage.buckets where id = 'vendor-files';
