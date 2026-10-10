\set ON_ERROR_STOP on
\pset footer off
\echo '>>> UPS accounts: WWEX is the default parcel shipper; only one default (expect 1 error)'
reset role;
select name, ups_account, is_default_parcel from public.carriers where ups_account is not null order by name;
\set ON_ERROR_STOP off
insert into public.carriers (organization_id, name, mode, is_default_parcel) values ('00000000-0000-0000-0000-000000000001', 'Default Parcel B', 'parcel', true);
\set ON_ERROR_STOP on
