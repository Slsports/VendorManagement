-- 0044 — Remove a rep group that is not one (Dana, Oct 8: "Eagle Claw is a vendor, not a rep group").
-- Its vendors stay vendors without a rep group, its lines stay as catalog names, its reps go, and mail that
-- was filed through it is asked about again. Then the Eagle Claw one goes.
create or replace function public.delete_rep_group(p_group uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  g public.rep_groups%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers remove rep groups' using errcode = '42501'; end if;
  select * into g from public.rep_groups where id = p_group for update;
  if g.id is null or not public.user_in_org(g.organization_id) then raise exception 'Rep group not found' using errcode = '23503'; end if;
  update public.vendors set rep_group_id = null where rep_group_id = p_group;
  update public.email_senders set kind = 'unknown', rep_group_id = null, decided_at = null, decided_by = null where rep_group_id = p_group and kind = 'rep_group';
  insert into public.activity_log (organization_id, entity_type, entity_id, action, details, actor_id)
  values (g.organization_id, 'rep_group', p_group, 'rep_group_deleted', jsonb_build_object('name', g.name), auth.uid());
  delete from public.rep_groups where id = p_group;
end;
$$;
revoke execute on function public.delete_rep_group(uuid) from public, anon;
grant execute on function public.delete_rep_group(uuid) to authenticated, service_role;

do $$ declare g record; begin
  for g in select r.id from public.rep_groups r
            where r.name = 'Eagle Claw'
              and not exists (select 1 from public.rep_group_contacts c where c.rep_group_id = r.id)
              and not exists (select 1 from public.vendor_directory d where d.rep_group_id = r.id) loop
    update public.vendors set rep_group_id = null where rep_group_id = g.id;
    update public.email_senders set kind = 'unknown', rep_group_id = null where rep_group_id = g.id and kind = 'rep_group';
    delete from public.rep_groups where id = g.id;
  end loop;
end $$;
