-- 0382: the admin saves a page's wording; a manager reads it but cannot change it.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; n int;
begin
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  set local role authenticated;
  if not public.is_admin() then reset role; raise exception 'test user is not the admin'; end if;
  insert into public.page_texts (organization_id, page_key, description) values (v_org, '/snopark', 'Our permit books.');
  reset role;
  if (select updated_by from public.page_texts where page_key = '/snopark') <> '11111111-1111-1111-1111-111111111111' then raise exception 'not stamped'; end if;
  perform set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into n from public.page_texts where page_key = '/snopark';
  update public.page_texts set description = 'changed' where page_key = '/snopark';
  reset role;
  if n <> 1 then raise exception 'manager cannot read it'; end if;
  if (select description from public.page_texts where page_key = '/snopark') <> 'Our permit books.' then raise exception 'manager changed it'; end if;
  perform set_config('request.jwt.claims', '', true);
  raise exception 'ok-rollback';
exception when others then
  reset role;
  if sqlerrm <> 'ok-rollback' then raise; end if;
end $$;
