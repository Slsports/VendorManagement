-- =============================================================================
-- 0001 — Foundation: organizations (tenants), stores, profiles, store access, RLS
-- Spec: development-strategy.md §1C/1D, overridden by vendor-pipeline-and-platform-spec.md §11.2/§11.3/§12
--
-- Design rules applied here and in every later migration:
--   * UUID primary keys, soft deletes via is_active, updated_at maintained by trigger.
--   * Organizations are the top-level tenant. Every tenant-owned row carries
--     organization_id directly or resolves to it through its store.
--   * RLS on every table. Helper functions are SECURITY DEFINER with an empty
--     search_path so they can read profiles without recursing into RLS.
--   * Nothing assumes a single tenant; SLSI is simply the first seeded organization.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('admin', 'manager', 'buyer', 'viewer');

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at current
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- organizations (tenants)
-- ---------------------------------------------------------------------------
create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  slug          text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  legal_name    text,
  app_name      text,                                   -- white-label app title; null = "<name> VMS"
  logo_url      text,                                   -- storage path or URL; null = default mark
  accent_color  text not null default '#2f5d3a' check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  settings      jsonb not null default '{}'::jsonb,     -- timezone, feature flags, AI thresholds, etc.
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.organizations is 'Tenant. Every store, user and business record belongs to exactly one organization.';
comment on column public.organizations.settings is 'Free-form tenant settings (timezone, feature flags, enrichment auto-accept threshold, ...).';

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- stores
-- ---------------------------------------------------------------------------
create table public.stores (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  code             text not null check (code = upper(code) and code ~ '^[A-Z0-9]{1,8}$'),
  name             text not null,
  aliases          text[] not null default '{}',        -- spreadsheet codes that map to this store on import
  address          text,
  city             text,
  state            text,
  postal_code      text,
  phone            text,
  email            text,
  sort_order       integer not null default 0,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, code)
);

comment on table public.stores is 'Physical store locations within an organization.';
comment on column public.stores.aliases is 'Alternate codes seen in spreadsheets (e.g. HAPPY, HC for GS). Matched case-insensitively on import.';

create index stores_organization_id_idx on public.stores (organization_id);

create trigger stores_set_updated_at
  before update on public.stores
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- profiles (extends auth.users)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  email            text not null,
  full_name        text not null default '',
  role             public.user_role not null default 'viewer',
  avatar_url       text,
  phone            text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.profiles is 'Application profile for each auth user. Created automatically by the on_auth_user_created trigger.';
comment on column public.profiles.role is 'admin | manager | buyer | viewer. Buyer dropdowns list buyers plus admins.';

create index profiles_organization_id_idx on public.profiles (organization_id);
create index profiles_organization_role_idx on public.profiles (organization_id, role) where is_active;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- user_store_access (which stores a non-admin user may work in)
-- Admins implicitly have access to every store in their organization.
-- ---------------------------------------------------------------------------
create table public.user_store_access (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  store_id    uuid not null references public.stores(id) on delete cascade,
  granted_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (user_id, store_id)
);

comment on table public.user_store_access is 'Explicit store grants for managers, buyers and viewers. Admins do not need rows here.';

create index user_store_access_store_id_idx on public.user_store_access (store_id);

-- ---------------------------------------------------------------------------
-- Access helper functions (SECURITY DEFINER, used by RLS policies everywhere)
-- ---------------------------------------------------------------------------
create or replace function public.current_user_org()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select organization_id
  from public.profiles
  where id = auth.uid() and is_active;
$$;
comment on function public.current_user_org() is 'Organization of the calling user, or null when signed out / deactivated.';

create or replace function public.current_user_role()
returns public.user_role
language sql stable security definer
set search_path = ''
as $$
  select role
  from public.profiles
  where id = auth.uid() and is_active;
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid() and is_active),
    false
  );
$$;

create or replace function public.user_in_org(org_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select organization_id = org_id from public.profiles where id = auth.uid() and is_active),
    false
  );
$$;
comment on function public.user_in_org(uuid) is 'Tenant check: true when the calling user belongs to org_id. RLS checks this before any store check.';

create or replace function public.store_organization_id(p_store_id uuid)
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select organization_id from public.stores where id = p_store_id;
$$;

create or replace function public.user_has_store_access(p_store_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.stores s
    join public.profiles p
      on p.id = auth.uid()
     and p.is_active
     and p.organization_id = s.organization_id
    where s.id = p_store_id
      and (
        p.role = 'admin'
        or exists (
          select 1 from public.user_store_access usa
          where usa.user_id = p.id and usa.store_id = s.id
        )
      )
  );
$$;
comment on function public.user_has_store_access(uuid) is 'True when the caller is an admin of the store''s organization or has an explicit user_store_access grant.';

-- Lock the helpers down: callable by app roles, not by anonymous/public.
revoke execute on function public.current_user_org() from public, anon;
revoke execute on function public.current_user_role() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.user_in_org(uuid) from public, anon;
revoke execute on function public.store_organization_id(uuid) from public, anon;
revoke execute on function public.user_has_store_access(uuid) from public, anon;
grant execute on function public.current_user_org() to authenticated, service_role;
grant execute on function public.current_user_role() to authenticated, service_role;
grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.user_in_org(uuid) to authenticated, service_role;
grant execute on function public.store_organization_id(uuid) to authenticated, service_role;
grant execute on function public.user_has_store_access(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------

-- A store grant must stay inside one organization.
create or replace function public.check_user_store_same_org()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user_org  uuid;
  v_store_org uuid;
begin
  select organization_id into v_user_org  from public.profiles where id = new.user_id;
  select organization_id into v_store_org from public.stores   where id = new.store_id;
  if v_user_org is null or v_store_org is null or v_user_org <> v_store_org then
    raise exception 'User % and store % belong to different organizations', new.user_id, new.store_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger user_store_access_same_org
  before insert or update on public.user_store_access
  for each row execute function public.check_user_store_same_org();

-- Only admins may change privileged profile columns; nobody may move a profile between tenants.
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
    or new.email     is distinct from old.email then
      raise exception 'Only administrators can change role, active status or email' using errcode = '42501';
    end if;
  elsif new.id = auth.uid()
    and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
    raise exception 'Administrators cannot change their own role or deactivate themselves' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger profiles_protect_privileged_columns
  before update on public.profiles
  for each row execute function public.protect_profile_privileged_columns();

-- ---------------------------------------------------------------------------
-- auth.users → profiles sync
-- ---------------------------------------------------------------------------

-- Default tenant used when a new auth user carries no organization in app_metadata.
create or replace function public.default_organization_id()
returns uuid
language sql stable
set search_path = ''
as $$
  select '00000000-0000-0000-0000-000000000001'::uuid;
$$;
comment on function public.default_organization_id() is 'Seeded first tenant (SLSI). New tenants must set app_metadata.organization_id on their users instead of relying on this.';

-- Create a profile for every new auth user.
--   * organization_id, role and store_codes are read from raw_app_meta_data only
--     (set server-side by the service role / admin API; users cannot forge it).
--   * The first user in an organization bootstraps as admin.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_org       uuid;
  v_role      public.user_role := 'viewer';
  v_is_first  boolean;
  v_full_name text;
begin
  v_org := coalesce(
    nullif(new.raw_app_meta_data ->> 'organization_id', '')::uuid,
    public.default_organization_id()
  );

  if not exists (select 1 from public.organizations where id = v_org) then
    raise exception 'Organization % does not exist', v_org using errcode = '23503';
  end if;

  select not exists (select 1 from public.profiles where organization_id = v_org) into v_is_first;

  if v_is_first then
    v_role := 'admin';
  elsif coalesce(new.raw_app_meta_data ->> 'role', '') in ('admin', 'manager', 'buyer', 'viewer') then
    v_role := (new.raw_app_meta_data ->> 'role')::public.user_role;
  end if;

  v_full_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    ''
  );

  insert into public.profiles (id, organization_id, email, full_name, role, avatar_url)
  values (new.id, v_org, coalesce(new.email, ''), v_full_name, v_role, new.raw_user_meta_data ->> 'avatar_url');

  -- Optional explicit store grants, e.g. app_metadata.store_codes = ["SLS","GS"].
  if jsonb_typeof(new.raw_app_meta_data -> 'store_codes') = 'array' then
    insert into public.user_store_access (user_id, store_id)
    select new.id, s.id
    from public.stores s
    where s.organization_id = v_org
      and s.code in (select upper(x) from jsonb_array_elements_text(new.raw_app_meta_data -> 'store_codes') as x)
    on conflict do nothing;
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Keep profiles.email in step with auth.users.email.
create or replace function public.handle_user_email_change()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = coalesce(new.email, '') where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.organizations    enable row level security;
alter table public.stores           enable row level security;
alter table public.profiles         enable row level security;
alter table public.user_store_access enable row level security;

-- organizations: members read their own tenant; admins update it; nobody inserts/deletes via the API.
create policy "organizations: members can read their organization"
  on public.organizations for select to authenticated
  using (public.user_in_org(id));

create policy "organizations: admins can update their organization"
  on public.organizations for update to authenticated
  using (public.is_admin() and public.user_in_org(id))
  with check (public.is_admin() and public.user_in_org(id));

-- stores: visible when the user has access (admins: all stores in their org); admins manage them.
create policy "stores: users can read stores they have access to"
  on public.stores for select to authenticated
  using (public.user_has_store_access(id));

create policy "stores: admins can insert stores in their organization"
  on public.stores for insert to authenticated
  with check (public.is_admin() and public.user_in_org(organization_id));

create policy "stores: admins can update stores in their organization"
  on public.stores for update to authenticated
  using (public.is_admin() and public.user_in_org(organization_id))
  with check (public.is_admin() and public.user_in_org(organization_id));

-- profiles: anyone in the org can see coworker names (buyer dropdowns, activity feeds);
-- users edit their own row; admins edit any row in their org. Privileged columns are trigger-guarded.
create policy "profiles: members can read profiles in their organization"
  on public.profiles for select to authenticated
  using (public.user_in_org(organization_id));

create policy "profiles: users can update their own profile"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "profiles: admins can update profiles in their organization"
  on public.profiles for update to authenticated
  using (public.is_admin() and public.user_in_org(organization_id))
  with check (public.is_admin() and public.user_in_org(organization_id));

-- user_store_access: users see their own grants; admins manage grants for stores in their org.
create policy "user_store_access: users can read their own grants"
  on public.user_store_access for select to authenticated
  using (
    user_id = auth.uid()
    or (public.is_admin() and public.user_in_org(public.store_organization_id(store_id)))
  );

create policy "user_store_access: admins can grant in their organization"
  on public.user_store_access for insert to authenticated
  with check (public.is_admin() and public.user_in_org(public.store_organization_id(store_id)));

create policy "user_store_access: admins can revoke in their organization"
  on public.user_store_access for delete to authenticated
  using (public.is_admin() and public.user_in_org(public.store_organization_id(store_id)));

-- Belt and braces: the anon role gets nothing from these tables even if a policy is added later.
revoke all on public.organizations, public.stores, public.profiles, public.user_store_access from anon;

-- ---------------------------------------------------------------------------
-- Seed: organization #1 (Shaver Lake Sports Inc.) and its four stores
-- ---------------------------------------------------------------------------
insert into public.organizations (id, name, slug, legal_name, app_name, accent_color, settings)
values (
  '00000000-0000-0000-0000-000000000001',
  'Shaver Lake Sports',
  'slsi',
  'Shaver Lake Sports Inc.',
  'Shaver Lake Sports VMS',
  '#2f5d3a',
  '{"timezone": "America/Los_Angeles"}'::jsonb
)
on conflict (id) do nothing;

insert into public.stores (organization_id, code, name, aliases, city, state, sort_order)
values
  ('00000000-0000-0000-0000-000000000001', 'SLS', 'Shaver Lake Sports',              '{}',         'Shaver Lake', 'CA', 1),
  ('00000000-0000-0000-0000-000000000001', 'SLH', 'Shaver Lake Hardware',            '{}',         'Shaver Lake', 'CA', 2),
  ('00000000-0000-0000-0000-000000000001', 'SLM', 'Shaver Lake Marina',              '{}',         'Shaver Lake', 'CA', 3),
  ('00000000-0000-0000-0000-000000000001', 'GS',  'The Happy Camper General Store',  '{HAPPY,HC}', 'Shaver Lake', 'CA', 4)
on conflict (organization_id, code) do nothing;
