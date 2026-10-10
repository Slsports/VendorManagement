-- =============================================================================
-- 0010 — Vendor directory: reference lists of vendors we may not have on file yet
-- (Dana, 2026-10-05: the Worldwide show vendor list — "all of these vendors are
-- WWD... keep it in a file so when an email comes in it checks if it's a WWD vendor").
-- Rows here are NOT vendors. They answer "is this name/domain a known WWD (or
-- Faire) vendor?" when a new vendor is created from the mailbox or the intake form.
-- =============================================================================
create table if not exists public.vendor_directory (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  source             text not null,                       -- e.g. wwd_show_2026_08
  source_label       text,                                -- e.g. "Worldwide show list, Aug 2026"
  name               text not null,
  name_key           text generated always as (lower(regexp_replace(name, '[^a-z0-9]+', '', 'gi'))) stored,
  route              public.billing_route not null default 'worldwide',
  email_domain       text,                                -- lower-case, no @
  email              text,
  website            text,
  phone              text,
  rep_name           text,
  booth              text,
  data               jsonb not null default '{}'::jsonb,  -- every other column from the sheet, as uploaded
  matched_vendor_id  uuid references public.vendors(id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (organization_id, source, name_key)
);
comment on table public.vendor_directory is 'Reference lists (show vendor lists etc). Not vendors; used to recognise and route new vendors.';
create index if not exists vendor_directory_key_idx on public.vendor_directory (organization_id, name_key);
create index if not exists vendor_directory_domain_idx on public.vendor_directory (organization_id, email_domain) where email_domain is not null;

alter table public.vendor_directory enable row level security;
drop policy if exists "vendor_directory: members read" on public.vendor_directory;
drop policy if exists "vendor_directory: editors write" on public.vendor_directory;
create policy "vendor_directory: members read" on public.vendor_directory for select to authenticated using (public.user_in_org(organization_id));
create policy "vendor_directory: editors write" on public.vendor_directory for all to authenticated
  using (public.user_can_edit() and public.user_in_org(organization_id)) with check (public.user_can_edit() and public.user_in_org(organization_id));
grant select, insert, update, delete on table public.vendor_directory to authenticated;
grant all on table public.vendor_directory to service_role;

-- Look a name or email domain up in the directory: which route is it known for?
create or replace function public.directory_route_for(p_org uuid, p_name text, p_domain text default null)
returns public.billing_route language sql stable security definer set search_path = '' as $$
  select route from public.vendor_directory
  where organization_id = p_org
    and (name_key = lower(regexp_replace(coalesce(p_name, ''), '[^a-z0-9]+', '', 'gi'))
         or (p_domain is not null and email_domain = lower(p_domain)))
  order by matched_vendor_id is not null desc, created_at desc
  limit 1;
$$;
revoke execute on function public.directory_route_for(uuid, text, text) from public, anon;
grant execute on function public.directory_route_for(uuid, text, text) to authenticated, service_role;
