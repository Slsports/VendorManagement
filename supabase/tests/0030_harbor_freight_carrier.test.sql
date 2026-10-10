\set ON_ERROR_STOP on
\pset footer off
\echo '>>> HARBOR FREIGHT is gone and excluded (none in the test data: nothing to do, no error)'
select count(*) as harbor_freight_vendors from public.vendors where name = 'HARBOR FREIGHT';
