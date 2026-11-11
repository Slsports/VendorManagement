-- A task closed as made by mistake stays 'mistake' (hidden), sends no "finished" notice, and a reopen clears it.
begin;
select '00000000-0000-0000-0000-000000000001'::uuid as org, '11111111-1111-1111-1111-111111111111'::uuid as me \gset
insert into public.tasks (organization_id, title, assigned_to, created_by, auto_key) values (:'org', 'MK339 a', :'me', :'me', 'mk339:a') returning id as a \gset
insert into public.tasks (organization_id, title, assigned_to, created_by) values (:'org', 'MK339 b', :'me', :'me') returning id as b \gset
update public.tasks set done_at = now(), closed_how = 'mistake', done_note = 'Made by mistake' where id = :'a';
update public.tasks set done_at = now(), done_by = :'me' where id = :'b';
select set_config('t.a', :'a', false), set_config('t.b', :'b', false);
do $$ begin
  if (select closed_how from public.tasks where id = current_setting('t.a')::uuid) is distinct from 'mistake' then raise exception 'a mistake was not kept as mistake'; end if;
  if (select done_notified_at is null or done_seen_at is null from public.tasks where id = current_setting('t.a')::uuid) then raise exception 'a mistake would send a finished notice'; end if;
  if (select closed_how from public.tasks where id = current_setting('t.b')::uuid) is distinct from 'person' then raise exception 'a person''s close changed'; end if;
end $$;
-- its rule cannot make it again: the auto_key row is still there
insert into public.tasks (organization_id, title, assigned_to, auto_key) values (:'org', 'MK339 again', :'me', 'mk339:a')
  on conflict (organization_id, auto_key) where auto_key is not null do nothing;
do $$ begin
  if (select count(*) from public.tasks where auto_key = 'mk339:a') <> 1 then raise exception 'a mistake task came back'; end if;
end $$;
update public.tasks set done_at = null where id = :'a';
do $$ begin
  if (select closed_how from public.tasks where id = current_setting('t.a')::uuid) is not null then raise exception 'reopen did not clear mistake'; end if;
end $$;
rollback;
