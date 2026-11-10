\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0328: a draft keeps its files'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
insert into public.email_drafts (organization_id, owner_id, subject, files)
  values ('00000000-0000-0000-0000-000000000001', :'admin_id', 'PARICON reorder for Shaver Lake Sports',
          '[{"name":"PARICON reorder items 11-9-26.xlsx","mime":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","path":"00000000-0000-0000-0000-000000000001/drafts/x/a.xlsx","size":5120}]')
  returning id as d \gset
select jsonb_array_length(files) = 1 and files->0->>'name' like 'PARICON%' as files_kept from public.email_drafts where id = :'d';
\echo '>>> files must be a list'
do $$ begin
  begin
    insert into public.email_drafts (organization_id, owner_id, subject, files) select '00000000-0000-0000-0000-000000000001', id, 'x', '{}'::jsonb from public.profiles where role = 'admin' limit 1;
    raise exception 'object accepted';
  exception when check_violation then null;
  end;
end $$;
select true as not_a_list_refused;
delete from public.email_drafts where id = :'d';
