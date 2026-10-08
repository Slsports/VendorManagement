-- 0032 — Delete a vendor that never belonged (Dana, Oct 8: "Shaver Lake Sports Internal Consumption").
-- From the Review queue a vendor can be deleted completely: its review items close, its mail goes back
-- to unfiled, and its names are remembered so no import brings it back. A vendor with orders is never
-- deleted (it is made inactive instead): past purchases, files and items stay.

create table if not exists public.vendor_exclusions (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  name             text not null,
  name_key         text generated always as (lower(regexp_replace(name, '[^a-z0-9]+', '', 'gi'))) stored,
  note             text,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (organization_id, name_key)
);
comment on table public.vendor_exclusions is 'Names deleted as "not a vendor". Imports skip them; people get a clear message.';

alter table public.vendor_exclusions enable row level security;
drop policy if exists "vendor_exclusions: members read" on public.vendor_exclusions;
create policy "vendor_exclusions: members read" on public.vendor_exclusions for select to authenticated using (public.user_in_org(organization_id));
drop policy if exists "vendor_exclusions: admins remove" on public.vendor_exclusions;
create policy "vendor_exclusions: admins remove" on public.vendor_exclusions for delete to authenticated using (public.is_admin() and public.user_in_org(organization_id));
grant select, delete on table public.vendor_exclusions to authenticated;
grant all on table public.vendor_exclusions to service_role;

-- A deleted name never comes back: imports (no signed-in user) skip it quietly; a person is told why.
create or replace function public.vendor_block_excluded()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_name text;
begin
  select x.name into v_name from public.vendor_exclusions x
   where x.organization_id = new.organization_id
     and x.name_key in (lower(regexp_replace(new.name, '[^a-z0-9]+', '', 'gi')), lower(regexp_replace(coalesce(new.lightspeed_name, ''), '[^a-z0-9]+', '', 'gi')))
   limit 1;
  if v_name is null then return new; end if;
  if auth.uid() is null then return null; end if;
  raise exception '"%" was deleted as not a vendor. An admin can allow it again in Settings > Organization.', v_name using errcode = '23505';
end;
$$;
drop trigger if exists vendors_block_excluded on public.vendors;
create trigger vendors_block_excluded before insert on public.vendors for each row execute function public.vendor_block_excluded();
revoke execute on function public.vendor_block_excluded() from public, anon, authenticated;

create or replace function public.delete_vendor(p_vendor uuid, p_note text default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  v     public.vendors%rowtype;
  n     text;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers delete vendors' using errcode = '42501'; end if;
  select * into v from public.vendors where id = p_vendor for update;
  if v.id is null or not public.user_in_org(v.organization_id) then raise exception 'Vendor not found' using errcode = '23503'; end if;
  if exists (select 1 from public.orders o where o.vendor_id = p_vendor) then
    raise exception '% has orders, so it is kept. Make it inactive instead.', v.name using errcode = '23503';
  end if;

  for n in select distinct x from unnest(array[v.name, v.lightspeed_name] || v.aliases) as x where nullif(trim(x), '') is not null loop
    insert into public.vendor_exclusions (organization_id, name, note, created_by)
    values (v.organization_id, n, coalesce(p_note, 'Deleted from the review queue: not a vendor'), auth.uid())
    on conflict (organization_id, name_key) do nothing;
  end loop;

  update public.review_items
     set status = 'rejected', resolved_by = auth.uid(), resolved_at = now(), resolution_note = 'Vendor deleted: not a vendor'
   where status = 'pending' and organization_id = v.organization_id
     and ((entity_type = 'vendor' and entity_id = p_vendor) or details->>'other_vendor_id' = p_vendor::text or details->>'vendor_id' = p_vendor::text);
  -- Mail that was filed to it goes back to unfiled; its senders are asked about again.
  update public.email_senders set kind = 'unknown', vendor_id = null, decided_at = null, decided_by = null
   where vendor_id = p_vendor and kind = 'vendor';

  insert into public.activity_log (organization_id, entity_type, entity_id, action, details, actor_id)
  values (v.organization_id, 'vendor', p_vendor, 'vendor_deleted', jsonb_build_object('name', v.name, 'note', p_note), auth.uid());

  delete from public.vendors where id = p_vendor;
end;
$$;
revoke execute on function public.delete_vendor(uuid, text) from public, anon;
grant execute on function public.delete_vendor(uuid, text) to authenticated, service_role;
