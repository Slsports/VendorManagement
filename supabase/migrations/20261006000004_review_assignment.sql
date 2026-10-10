-- 0016 — Review assignment (Dana, 2026-10-06: "I'm going to want to be able to assign the reviews
-- to an employee. Like all fishing reviews go to Jarrett").
-- Every review item can carry an assignee. Rules in Settings decide the assignee when an item is
-- created: a single vendor, fishing vendors (the is_fishing flag or a FISHING department on the
-- item), a Lightspeed department named in the item's details, a kind of review, or a fallback.
-- The same rules will route the category clean-up batches and the item/category mismatches once
-- Lightspeed is connected.

alter table public.review_items add column if not exists assigned_to uuid references public.profiles(id) on delete set null;
alter table public.review_items add column if not exists assigned_at timestamptz;
comment on column public.review_items.assigned_to is 'Who works this item. Set by review_assignment_rules on insert, or by hand.';
create index if not exists review_items_assigned_idx on public.review_items (organization_id, assigned_to) where status = 'pending';

create table if not exists public.review_assignment_rules (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  match_kind       text not null check (match_kind in ('vendor', 'fishing', 'department', 'review_kind', 'fallback')),
  match_value      text,                                   -- department name, or review kind
  vendor_id        uuid references public.vendors(id) on delete cascade,
  assignee_id      uuid not null references public.profiles(id) on delete cascade,
  priority         integer not null default 100,           -- lower runs first
  is_active        boolean not null default true,
  note             text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint review_assignment_rules_value_check check (
    (match_kind in ('department', 'review_kind') and nullif(trim(match_value), '') is not null)
    or (match_kind = 'vendor' and vendor_id is not null)
    or (match_kind in ('fishing', 'fallback'))
  )
);
comment on table public.review_assignment_rules is 'Who gets which review items. Evaluated in priority order, most specific kind first at equal priority; the first match wins.';
create index if not exists review_assignment_rules_org_idx on public.review_assignment_rules (organization_id, priority) where is_active;

-- Pick the assignee for an item. Runs as definer so the trigger can read vendors and rules whatever the caller may see.
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
  r         record;
begin
  v_vendor := case when p_entity_type = 'vendor' then p_entity_id else nullif(p_details->>'vendor_id', '')::uuid end;
  v_other  := nullif(p_details->>'other_vendor_id', '')::uuid;
  v_dept   := upper(nullif(trim(coalesce(p_details->>'department', '')), ''));
  v_fishing := (v_dept = 'FISHING')
    or exists (select 1 from public.vendors v where v.id in (v_vendor, v_other) and v.is_fishing);
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
    if r.match_kind = 'fallback' then return r.assignee_id; end if;
  end loop;
  return null;
end;
$$;

create or replace function public.review_item_assign()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.assigned_to is null then
    new.assigned_to := public.review_assignee_for(new.organization_id, new.kind, new.entity_type, new.entity_id, new.details);
  end if;
  if new.assigned_to is not null and new.assigned_at is null then
    new.assigned_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists review_items_assign on public.review_items;
create trigger review_items_assign before insert on public.review_items for each row execute function public.review_item_assign();

-- Hand an item to someone (or nobody). Admins, managers and buyers.
create or replace function public.assign_review_item(p_item uuid, p_profile uuid default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  it public.review_items%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers assign reviews'; end if;
  select * into it from public.review_items where id = p_item for update;
  if not found or not public.user_in_org(it.organization_id) then raise exception 'Review item not found'; end if;
  if p_profile is not null and not exists (select 1 from public.profiles p where p.id = p_profile and p.organization_id = it.organization_id and p.is_active) then
    raise exception 'That person is not an active user here';
  end if;
  update public.review_items
     set assigned_to = p_profile, assigned_at = case when p_profile is null then null else now() end
   where id = p_item;
end;
$$;

-- Run the rules over waiting items: unassigned ones by default, every pending one with p_overwrite. Admins only. Returns how many changed.
create or replace function public.apply_review_rules(p_org uuid, p_overwrite boolean default false)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  it      record;
  v_new   uuid;
  v_count integer := 0;
begin
  if not (public.is_admin() and public.user_in_org(p_org)) then raise exception 'Only admins apply assignment rules'; end if;
  for it in select * from public.review_items where organization_id = p_org and status = 'pending' and (p_overwrite or assigned_to is null) loop
    v_new := public.review_assignee_for(p_org, it.kind, it.entity_type, it.entity_id, it.details);
    if v_new is distinct from it.assigned_to and v_new is not null then
      update public.review_items set assigned_to = v_new, assigned_at = now() where id = it.id;
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

alter table public.review_assignment_rules enable row level security;
drop policy if exists "review_rules: members read" on public.review_assignment_rules;
drop policy if exists "review_rules: admins write" on public.review_assignment_rules;
create policy "review_rules: members read" on public.review_assignment_rules for select to authenticated using (public.user_in_org(organization_id));
create policy "review_rules: admins write" on public.review_assignment_rules for all to authenticated
  using (public.is_admin() and public.user_in_org(organization_id)) with check (public.is_admin() and public.user_in_org(organization_id));
grant select, insert, update, delete on table public.review_assignment_rules to authenticated;
grant all on table public.review_assignment_rules to service_role;
grant execute on function public.review_assignee_for(uuid, text, text, uuid, jsonb) to authenticated, service_role;
grant execute on function public.assign_review_item(uuid, uuid) to authenticated, service_role;
grant execute on function public.apply_review_rules(uuid, boolean) to authenticated, service_role;

-- Dana's first rule: all fishing reviews go to Jarrett, when his account exists.
insert into public.review_assignment_rules (organization_id, match_kind, assignee_id, priority, note)
select p.organization_id, 'fishing', p.id, 20, 'Dana, Oct 6 2026: all fishing reviews go to Jarrett'
from public.profiles p
where lower(p.email) like 'jarrett@%' and p.is_active
  and not exists (select 1 from public.review_assignment_rules r where r.organization_id = p.organization_id and r.match_kind = 'fishing');
