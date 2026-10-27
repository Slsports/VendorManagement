\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0255: Emery Jensen file only (hosted data; the local copy has no such vendor)'
reset role;
select count(*) = 0 as no_open_ej_checks from public.order_checks where vendor_id = 'e43d9b97-3c37-47a0-88cb-7d6cb8475a2e' and status not in ('done', 'dismissed', 'not_paperwork');
