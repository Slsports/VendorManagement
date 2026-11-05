-- 0312 — Only Dana turns Ask VMS on or off for someone (Settings › Users, Ask VMS tick). profiles.ask_vms joins the
-- columns only the admin may change; a person cannot tick it for themselves.

set local lock_timeout = '5s';

create or replace function public.protect_profile_privileged_columns()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'A profile cannot be moved to another organization' using errcode = '42501';
  end if;
  if new.can_see is distinct from old.can_see then
    new.can_see := coalesce(array(select distinct x from unnest(new.can_see) x
      where x <> new.id and exists (select 1 from public.profiles p where p.id = x and p.organization_id = new.organization_id)), '{}');
  end if;
  if auth.uid() is null then
    return new;
  end if;
  if not public.is_admin() then
    if new.role      is distinct from old.role
    or new.is_active is distinct from old.is_active
    or new.email     is distinct from old.email
    or new.places_orders is distinct from old.places_orders
    or new.sees_freight is distinct from old.sees_freight
    or new.sees_accounting is distinct from old.sees_accounting
    or new.enters_counts is distinct from old.enters_counts
    or new.sends_counts is distinct from old.sends_counts
    or new.can_see is distinct from old.can_see
    or new.can_dnr is distinct from old.can_dnr
    or new.handles_logistics is distinct from old.handles_logistics
    or new.note_initials is distinct from old.note_initials
    or new.ask_vms is distinct from old.ask_vms then
      raise exception 'Only administrators can change role, active status, email or what a person sees' using errcode = '42501';
    end if;
  elsif new.id = auth.uid()
    and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
    raise exception 'Administrators cannot change their own role or deactivate themselves' using errcode = '42501';
  end if;
  return new;
end;
$function$;
