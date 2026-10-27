\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0249: rep names out of vendor names (hosted data only; the local copy has none of these vendors)'
reset role;
select count(*) = 0 as no_rep_names_left from public.vendors where name in ('EXTENDED EXPOSURE-DONNA HOFFMAN', 'KURT S. ADLER-DONNA', 'OEELINN DONNA DIVERSE MARKETING');
