-- Item names by Trevor's SOP-INV-001-NC (Dana, Oct 19: "let's build the naming conventions and we will just adjust where
-- needed"). The checker lives in supabase/functions/_shared/itemNameSop.ts (browser and functions); this keeps what
-- people decide about LS names and the queue VMS writes to LS from.
--   approved → sending → sent | failed      skipped = "leave this name as it is" (until the name changes in LS)
-- A rename that changes what the name says (kind 'content') goes on Trevor's shelf-tag task, due in 7 days, one task a
-- day listing every item (SOP "Renaming an existing item"; Dana Oct 18: Trevor is in charge of shelf and price tags).

-- Proposal 2: the vendor's name for item names when the tag has no brand, and the Vendor ID setting for the SOP list.
alter table public.vendors add column if not exists item_name_vendor text;
comment on column public.vendors.item_name_vendor is 'The vendor''s name as it goes in LS item names when the item has no brand (ALL CAPS, never with WWD), SOP-INV-001-NC.';

-- The SOP's list: Coghlans, World Famous Sports, Lazy One and Ty end their item names with the Vendor ID.
update public.vendors set vid_in_description = true
where upper(name) in ('COGHLAN', 'COGHLANS', 'WORLD FAMOUS SPORTS', 'LAZY ONE', 'TY INC', 'TY') and not coalesce(vid_in_description, false);
update public.vendors set item_name_vendor = 'WFS' where upper(name) = 'WORLD FAMOUS SPORTS' and item_name_vendor is null;
update public.vendors set item_name_vendor = 'LAZY ONE' where upper(name) = 'LAZY ONE' and item_name_vendor is null;
update public.vendors set item_name_vendor = 'COGHLANS' where upper(name) in ('COGHLAN', 'COGHLANS') and item_name_vendor is null;
update public.vendors set item_name_vendor = 'TY' where upper(name) in ('TY INC', 'TY') and item_name_vendor is null;

create table if not exists public.item_name_changes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  ls_item_id       text not null,
  vendor_id        uuid references public.vendors(id) on delete set null,
  old_name         text not null,
  new_name         text not null,
  kind             text not null check (kind in ('cosmetic', 'content')),
  source           text not null default 'cleanup' check (source in ('cleanup', 'reorder', 'new_item')),
  status           text not null default 'approved' check (status in ('approved', 'sending', 'sent', 'failed', 'skipped')),
  approved_by      uuid references public.profiles(id) on delete set null,
  approved_at      timestamptz not null default now(),
  sent_at          timestamptz,
  ls_error         text,
  task_id          uuid references public.tasks(id) on delete set null,
  tries            integer not null default 0,
  claimed_at       timestamptz,
  created_at       timestamptz not null default now()
);
create unique index if not exists item_name_changes_open on public.item_name_changes (organization_id, ls_item_id) where status in ('approved', 'sending', 'skipped');
create index if not exists item_name_changes_status on public.item_name_changes (organization_id, status, approved_at);
comment on table public.item_name_changes is 'LS item renames people approved (or chose to leave), and the queue VMS sends to LS from (SOP-INV-001-NC).';

alter table public.item_name_changes enable row level security;
drop policy if exists "item_name_changes: members read" on public.item_name_changes;
create policy "item_name_changes: members read" on public.item_name_changes for select to authenticated using (public.user_in_org(organization_id));
grant select on public.item_name_changes to authenticated;
grant all on public.item_name_changes to service_role;

-- Approve renames (or leave names as they are): p_items = [{ls_item_id, old_name, new_name, kind, vendor_id}].
-- A second approval of the same item replaces the first while it is still waiting.
create or replace function public.item_names_decide(p_org uuid, p_items jsonb, p_skip boolean default false)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  it jsonb;
  n integer := 0;
begin
  if not (public.user_in_org(p_org) and public.user_can_edit()) then
    raise exception 'Only admins, managers and buyers change item names' using errcode = '42501';
  end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if coalesce(it->>'ls_item_id', '') = '' or coalesce(trim(it->>'old_name'), '') = '' then continue; end if;
    if not p_skip and (coalesce(trim(it->>'new_name'), '') = '' or it->>'new_name' = it->>'old_name') then continue; end if;
    delete from public.item_name_changes
    where organization_id = p_org and ls_item_id = it->>'ls_item_id' and status in ('approved', 'skipped');
    if exists (select 1 from public.item_name_changes where organization_id = p_org and ls_item_id = it->>'ls_item_id' and status = 'sending') then continue; end if;
    insert into public.item_name_changes (organization_id, ls_item_id, vendor_id, old_name, new_name, kind, source, status, approved_by)
    values (p_org, it->>'ls_item_id', nullif(it->>'vendor_id', '')::uuid, it->>'old_name',
            case when p_skip then it->>'old_name' else upper(trim(it->>'new_name')) end,
            case when it->>'kind' = 'content' then 'content' else 'cosmetic' end,
            case when it->>'source' in ('reorder', 'new_item') then it->>'source' else 'cleanup' end,
            case when p_skip then 'skipped' else 'approved' end, auth.uid());
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.item_names_decide(uuid, jsonb, boolean) from public, anon;
grant execute on function public.item_names_decide(uuid, jsonb, boolean) to authenticated, service_role;

-- Take back approvals not sent yet, or "leave as is" choices.
create or replace function public.item_names_undo(p_ids uuid[])
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers change item names' using errcode = '42501'; end if;
  delete from public.item_name_changes c
  where c.id = any(p_ids) and public.user_in_org(c.organization_id) and c.status in ('approved', 'skipped', 'failed');
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.item_names_undo(uuid[]) from public, anon;
grant execute on function public.item_names_undo(uuid[]) to authenticated, service_role;

-- Renames sent to LS that change what the name says go on today's shelf-tag task for the logistics person (Trevor),
-- due in 7 days: one task a day listing every item, so the tags are printed and taken to each store together.
create or replace function public.item_names_shelf_task(p_org uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  who uuid;
  k text := 'shelf_tags:' || to_char((now() at time zone 'America/Los_Angeles')::date, 'YYYY-MM-DD');
  t uuid;
  lines text;
  total integer;
begin
  if not exists (select 1 from public.item_name_changes where organization_id = p_org and status = 'sent' and kind = 'content' and task_id is null) then
    return null;
  end if;
  who := coalesce(public.logistics_person(p_org), (select id from public.profiles where organization_id = p_org and role = 'admin' and is_active order by created_at limit 1));
  -- today's open task; a finished one is never reopened (the next batch gets its own)
  select id into t from public.tasks where organization_id = p_org and auto_key like k || '%' and done_at is null order by created_at desc limit 1;
  if t is null then
    if exists (select 1 from public.tasks where organization_id = p_org and auto_key = k) then
      k := k || ':' || to_char(now(), 'HH24MISS');
    end if;
    insert into public.tasks (organization_id, title, notes, due_date, assigned_to, created_by, auto_key)
    values (p_org, 'Print new shelf tags', '', ((now() at time zone 'America/Los_Angeles')::date + 7), who, null, k)
    returning id into t;
  end if;
  update public.item_name_changes set task_id = t
  where organization_id = p_org and status = 'sent' and kind = 'content' and task_id is null;
  select count(*), string_agg(old_name || '  →  ' || new_name, E'\n' order by sent_at)
  into total, lines
  from public.item_name_changes where task_id = t;
  update public.tasks
  set title = format('Print new shelf tags (%s %s)', total, case when total = 1 then 'item' else 'items' end),
      notes = 'These LS names changed what they say. Print the new shelf tag for each, replace the old one at every store that carries it, and check it at the register (SOP: within 7 days).' || E'\n\n' || lines
  where id = t;
  return t;
end;
$$;
revoke execute on function public.item_names_shelf_task(uuid) from public, anon, authenticated;
grant execute on function public.item_names_shelf_task(uuid) to service_role;
