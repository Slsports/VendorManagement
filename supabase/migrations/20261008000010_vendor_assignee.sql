-- 0031 — Each vendor is assigned to the person who orders from it (Dana, Oct 8 2026).
-- "Report owner" was only who ran the sales report before the show; the person who orders now runs
-- it from VMS, so vendors.assigned_buyer_id (Assigned to) replaces it. Only people who place orders
-- can be assigned: Dana and Jarrett today; Raelee (Kelli's) and Cat (Mountain Milk) when they get
-- logins at go-live. Trevor ran reports but does not order: his vendors go to Jarrett, each with a
-- review item for Dana to change the ones that belong to someone else.
-- The assignee also gets the vendor's review items and mail when no Settings rule says otherwise.

alter table public.profiles add column if not exists places_orders boolean not null default false;
comment on column public.profiles.places_orders is 'Orders from vendors, so can be a vendor''s Assigned to. Admins set it.';

update public.profiles set places_orders = true
 where is_active and not places_orders and (role = 'admin' or lower(email) like 'jarrett@%');

-- Admins only, like role and active status.
create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'A profile cannot be moved to another organization' using errcode = '42501';
  end if;

  -- Service role / SQL editor (no JWT subject) may change anything else.
  if auth.uid() is null then
    return new;
  end if;

  if not public.is_admin() then
    if new.role      is distinct from old.role
    or new.is_active is distinct from old.is_active
    or new.email     is distinct from old.email
    or new.places_orders is distinct from old.places_orders then
      raise exception 'Only administrators can change role, active status, email or who places orders' using errcode = '42501';
    end if;
  elsif new.id = auth.uid()
    and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
    raise exception 'Administrators cannot change their own role or deactivate themselves' using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on column public.vendors.assigned_buyer_id is 'Assigned to: the person who orders from this vendor and runs its sales report. Gets its review items and mail unless a rule says otherwise.';
comment on column public.vendors.report_owner is 'Retired Oct 8 2026: who ran the pre-show sales report (from the order guide). Replaced by assigned_buyer_id.';

-- Only someone in the same organization who places orders can be assigned. A change answers any
-- waiting "who orders from this vendor" review.
create or replace function public.vendor_assignee_check()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.assigned_buyer_id is not null and (tg_op = 'INSERT' or new.assigned_buyer_id is distinct from old.assigned_buyer_id) then
    if not exists (select 1 from public.profiles p where p.id = new.assigned_buyer_id and p.organization_id = new.organization_id and p.is_active and p.places_orders) then
      raise exception 'Only someone who places orders can be assigned a vendor' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists vendors_assignee_check on public.vendors;
create trigger vendors_assignee_check before insert or update of assigned_buyer_id on public.vendors
  for each row execute function public.vendor_assignee_check();

create or replace function public.vendor_assignee_settle()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  update public.review_items
     set status = 'accepted', resolved_by = auth.uid(), resolved_at = now(),
         resolution_note = 'Assigned to ' || coalesce((select full_name from public.profiles where id = new.assigned_buyer_id), 'nobody')
   where entity_type = 'vendor' and entity_id = new.id and kind = 'vendor_assignment' and status = 'pending';
  return new;
end;
$$;
drop trigger if exists vendors_assignee_settle on public.vendors;
create trigger vendors_assignee_settle after update of assigned_buyer_id on public.vendors
  for each row when (new.assigned_buyer_id is distinct from old.assigned_buyer_id)
  execute function public.vendor_assignee_settle();

-- Set (or keep) who orders from a vendor and close its assignment review. Admins, managers and buyers.
create or replace function public.set_vendor_assignee(p_vendor uuid, p_profile uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v public.vendors%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers assign vendors' using errcode = '42501'; end if;
  select * into v from public.vendors where id = p_vendor for update;
  if v.id is null or not public.user_in_org(v.organization_id) then raise exception 'Vendor not found' using errcode = '23503'; end if;
  update public.vendors set assigned_buyer_id = p_profile where id = p_vendor;
  update public.review_items
     set status = 'accepted', resolved_by = auth.uid(), resolved_at = now(),
         resolution_note = 'Assigned to ' || coalesce((select full_name from public.profiles where id = p_profile), 'nobody')
   where entity_type = 'vendor' and entity_id = p_vendor and kind = 'vendor_assignment' and status = 'pending';
end;
$$;
revoke execute on function public.set_vendor_assignee(uuid, uuid) from public, anon;
grant execute on function public.set_vendor_assignee(uuid, uuid) to authenticated, service_role;
revoke execute on function public.vendor_assignee_check() from public, anon, authenticated;
revoke execute on function public.vendor_assignee_settle() from public, anon, authenticated;

-- Review items and mail: a matching Settings rule (one vendor, fishing, department, kind of review)
-- still wins; then the vendor's Assigned to; then the "everything else" rule.
create or replace function public.review_assignee_for(p_org uuid, p_kind text, p_entity_type text, p_entity_id uuid, p_details jsonb)
returns uuid
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_vendor  uuid;
  v_other   uuid;
  v_dept    text;
  v_fishing boolean;
  v_owner   uuid;
  r         record;
begin
  v_vendor := case when p_entity_type = 'vendor' then p_entity_id else nullif(p_details->>'vendor_id', '')::uuid end;
  v_other  := nullif(p_details->>'other_vendor_id', '')::uuid;
  v_dept   := upper(nullif(trim(coalesce(p_details->>'department', '')), ''));
  v_fishing := (v_dept = 'FISHING')
    or exists (select 1 from public.vendors v where v.id in (v_vendor, v_other) and v.is_fishing);
  select v.assigned_buyer_id into v_owner
    from public.vendors v join public.profiles p on p.id = v.assigned_buyer_id and p.is_active
   where v.id in (v_vendor, v_other) and v.organization_id = p_org
   order by (v.id = v_vendor) desc
   limit 1;
  for r in
    select * from public.review_assignment_rules
    where organization_id = p_org and is_active
    order by priority,
      case match_kind when 'vendor' then 0 when 'fishing' then 1 when 'department' then 2 when 'review_kind' then 3 else 4 end,
      created_at
  loop
    if r.match_kind = 'vendor' and r.vendor_id in (v_vendor, v_other) then return r.assignee_id; end if;
    if r.match_kind = 'fishing' and v_fishing then return r.assignee_id; end if;
    if r.match_kind = 'department' and v_dept is not null and upper(trim(r.match_value)) = v_dept then return r.assignee_id; end if;
    if r.match_kind = 'review_kind' and r.match_value = p_kind then return r.assignee_id; end if;
    if r.match_kind = 'fallback' then return coalesce(v_owner, r.assignee_id); end if;
  end loop;
  return v_owner;
end;
$$;

-- Start from the report owners: Dana's stay Dana's, Jarrett's stay his, Trevor's go to Jarrett.
update public.vendors v
   set assigned_buyer_id = p.id
  from public.profiles p
 where v.assigned_buyer_id is null
   and v.report_owner in ('Dana', 'Jarrett', 'Trevor')
   and p.organization_id = v.organization_id and p.is_active and p.places_orders
   and lower(p.full_name) like lower(case v.report_owner when 'Trevor' then 'Jarrett' else v.report_owner end) || '%';

-- One review per former Trevor vendor, for Dana (the admin) to keep with Jarrett or change.
insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details, assigned_to)
select v.organization_id, 'vendor_assignment', 'vendor', v.id,
       v.name || ': assigned to ' || p.full_name,
       jsonb_build_object('reason', 'Trevor ran its sales report before the show; he does not order, so it went to ' || p.full_name,
                          'proposed_assignee_id', p.id, 'proposed_assignee_name', p.full_name),
       (select a.id from public.profiles a where a.organization_id = v.organization_id and a.role = 'admin' and a.is_active order by a.created_at limit 1)
  from public.vendors v
  join public.profiles p on p.id = v.assigned_buyer_id
 where v.report_owner = 'Trevor' and v.is_active
   and not exists (select 1 from public.review_items r where r.entity_type = 'vendor' and r.entity_id = v.id and r.kind = 'vendor_assignment');
