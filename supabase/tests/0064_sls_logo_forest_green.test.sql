\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Organization #1 uses the new pin logo (0084)'
reset role;
select logo_url, logo_dark_url from public.organizations where id = '00000000-0000-0000-0000-000000000001';
do $$ begin
  assert (select logo_url = '/brand/sls/logo-mark.svg' and logo_dark_url = '/brand/sls/logo-mark-dark.svg'
          from public.organizations where id = '00000000-0000-0000-0000-000000000001'), 'org #1 logo not updated';
end $$;
