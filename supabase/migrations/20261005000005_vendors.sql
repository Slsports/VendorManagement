-- =============================================================================
-- 0008 — Vendors and reference data (Phase 3)
-- Strategy 1C vendors/rep_groups/categories/vendor_stores/vendor_categories/notes/
-- activity_log, spec §7 additions, and docs/decisions.md (billing routes, payment
-- terms list, delivery vendors, ordering windows, review queue).
--
-- Conventions: every table carries organization_id (child tables fill it from the
-- vendor by trigger), RLS checks the tenant first, editing needs an editor role,
-- vendors are never deleted (is_active), explicit grants at the end.
-- Deviation from spec §7.2: vendor_emails is unique per (vendor, email), not per
-- tenant, because one rep can represent several vendors.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.billing_route as enum ('worldwide', 'faire', 'direct');
create type public.contact_type as enum ('rep', 'ap', 'customer_service', 'shipping', 'orders', 'other');
create type public.contact_source as enum ('import', 'manual', 'email_enrichment', 'vendor_form');
create type public.ordering_frequency as enum ('weekly', 'monthly', 'seasonal', 'annual', 'as_needed');
create type public.order_window_kind as enum ('feb_show', 'aug_show', 'pre_season', 'reorder', 'delivery', 'custom');
create type public.review_status as enum ('pending', 'accepted', 'rejected');

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.user_can_edit()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    (select role in ('admin', 'manager', 'buyer') from public.profiles where id = auth.uid() and is_active),
    false
  );
$$;
comment on function public.user_can_edit() is 'True for admin, manager and buyer. Viewers and uploaders are read-only (or less).';
revoke execute on function public.user_can_edit() from public, anon;
grant execute on function public.user_can_edit() to authenticated, service_role;

-- Child tables: fill organization_id from the vendor, and refuse cross-tenant rows.
create or replace function public.set_org_from_vendor()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare v_org uuid;
begin
  select organization_id into v_org from public.vendors where id = new.vendor_id;
  if v_org is null then
    raise exception 'Vendor % does not exist', new.vendor_id using errcode = '23503';
  end if;
  if new.organization_id is null then
    new.organization_id := v_org;
  elsif new.organization_id <> v_org then
    raise exception 'Row belongs to a different organization than its vendor' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reference tables
-- ---------------------------------------------------------------------------
create table public.categories (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations(id) on delete restrict,
  name                    text not null,
  parent_id               uuid references public.categories(id) on delete set null,
  full_path               text,
  lightspeed_category_id  text,
  sort_order              integer not null default 0,
  is_active               boolean not null default true,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create unique index categories_org_name_key on public.categories (organization_id, lower(name));
create index categories_org_idx on public.categories (organization_id);
create trigger categories_set_updated_at before update on public.categories for each row execute function public.set_updated_at();

create table public.rep_groups (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  name             text not null,
  contact_name     text,
  email            text,
  phone            text,
  website          text,
  address          text,
  notes            text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index rep_groups_org_name_key on public.rep_groups (organization_id, lower(name));
create index rep_groups_org_idx on public.rep_groups (organization_id);
create trigger rep_groups_set_updated_at before update on public.rep_groups for each row execute function public.set_updated_at();

create table public.payment_terms (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete restrict,
  name              text not null,
  days_until_due    integer not null default 30 check (days_until_due >= 0),
  discount_percent  numeric(5,2) check (discount_percent is null or (discount_percent > 0 and discount_percent < 100)),
  discount_days     integer check (discount_days is null or discount_days >= 0),
  due_day_of_month  integer check (due_day_of_month is null or (due_day_of_month between 1 and 31)),
  is_default        boolean not null default false,
  is_active         boolean not null default true,
  sort_order        integer not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.payment_terms is 'Admin-managed list of payment terms per organization (docs/decisions.md).';
create unique index payment_terms_org_name_key on public.payment_terms (organization_id, lower(name));
create unique index payment_terms_one_default_per_org on public.payment_terms (organization_id) where is_default;
create trigger payment_terms_set_updated_at before update on public.payment_terms for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- vendors
-- ---------------------------------------------------------------------------
create table public.vendors (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations(id) on delete restrict,
  name                    text not null,
  lightspeed_name         text,                      -- exact vendor name in Lightspeed (null if not from LS)
  lightspeed_vendor_id    text,                      -- Lightspeed vendorID once the API is connected
  aliases                 text[] not null default '{}',
  rep_group_id            uuid references public.rep_groups(id) on delete set null,
  assigned_buyer_id       uuid references public.profiles(id) on delete set null,
  payment_terms_id        uuid references public.payment_terms(id) on delete set null,
  website                 text,
  account_number          text,
  catalog                 text,
  phone                   text,
  fax                     text,
  address                 text,
  city                    text,
  state                   text,
  postal_code             text,
  country                 text,
  rep_name                text,
  rep_phone               text,
  pickup_address          text,
  pickup_times            text,
  shipping_contact        text,
  shipping_contact_phone  text,
  return_notes            text,
  google_drive_folder     text,
  rating                  smallint check (rating is null or rating between 1 and 5),
  tier                    text,
  ordering_frequency      public.ordering_frequency,
  is_delivery_vendor      boolean not null default false,
  minimum_order           text,
  notes                   text,
  needs_review            boolean not null default false,
  review_note             text,
  is_active               boolean not null default true,
  created_by              uuid references public.profiles(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
comment on table public.vendors is 'Suppliers. Soft-deleted via is_active. Name is unique per organization (case-insensitive).';
comment on column public.vendors.aliases is 'Alternate names: the exact Lightspeed name, abbreviations (WFS), old spellings. Used for filename/email/import matching.';
create unique index vendors_org_name_key on public.vendors (organization_id, lower(name));
create index vendors_org_active_idx on public.vendors (organization_id, is_active);
create index vendors_aliases_gin on public.vendors using gin (aliases);
create index vendors_rep_group_idx on public.vendors (rep_group_id);
create trigger vendors_set_updated_at before update on public.vendors for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- vendor child tables
-- ---------------------------------------------------------------------------
create table public.vendor_billing_routes (
  organization_id  uuid references public.organizations(id) on delete restrict,
  vendor_id        uuid not null references public.vendors(id) on delete cascade,
  route            public.billing_route not null,
  is_default       boolean not null default false,
  account_number   text,
  notes            text,
  created_at       timestamptz not null default now(),
  primary key (vendor_id, route)
);
comment on table public.vendor_billing_routes is 'Ways SLSI can be billed for this vendor: worldwide, faire, direct. One marked default (decisions log).';
create unique index vendor_billing_routes_one_default on public.vendor_billing_routes (vendor_id) where is_default;
create index vendor_billing_routes_org_idx on public.vendor_billing_routes (organization_id);
create trigger vendor_billing_routes_org before insert or update on public.vendor_billing_routes for each row execute function public.set_org_from_vendor();

create table public.vendor_emails (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid references public.organizations(id) on delete restrict,
  vendor_id        uuid not null references public.vendors(id) on delete cascade,
  email            text not null check (position('@' in email) > 1),
  contact_name     text,
  title            text,
  phone            text,
  contact_type     public.contact_type not null default 'other',
  source           public.contact_source not null default 'manual',
  confidence       numeric(4,3) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  verified_at      timestamptz,
  is_primary       boolean not null default false,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.vendor_emails is 'Contacts and sender addresses per vendor (spec §7.2). Unique per vendor + email.';
create unique index vendor_emails_vendor_email_key on public.vendor_emails (vendor_id, lower(email));
create index vendor_emails_org_email_idx on public.vendor_emails (organization_id, lower(email));
create trigger vendor_emails_org before insert or update on public.vendor_emails for each row execute function public.set_org_from_vendor();
create trigger vendor_emails_set_updated_at before update on public.vendor_emails for each row execute function public.set_updated_at();

create table public.vendor_stores (
  organization_id  uuid references public.organizations(id) on delete restrict,
  vendor_id        uuid not null references public.vendors(id) on delete cascade,
  store_id         uuid not null references public.stores(id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (vendor_id, store_id)
);
create index vendor_stores_store_idx on public.vendor_stores (store_id);
create trigger vendor_stores_org before insert or update on public.vendor_stores for each row execute function public.set_org_from_vendor();

create table public.vendor_categories (
  organization_id  uuid references public.organizations(id) on delete restrict,
  vendor_id        uuid not null references public.vendors(id) on delete cascade,
  category_id      uuid not null references public.categories(id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (vendor_id, category_id)
);
create index vendor_categories_category_idx on public.vendor_categories (category_id);
create trigger vendor_categories_org before insert or update on public.vendor_categories for each row execute function public.set_org_from_vendor();

create table public.vendor_order_windows (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid references public.organizations(id) on delete restrict,
  vendor_id        uuid not null references public.vendors(id) on delete cascade,
  kind             public.order_window_kind not null default 'custom',
  label            text,
  months           smallint[] not null default '{}' check (months <@ array[1,2,3,4,5,6,7,8,9,10,11,12]::smallint[]),
  buyer_id         uuid references public.profiles(id) on delete set null,
  notes            text,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.vendor_order_windows is 'When SLSI typically orders from the vendor (decisions log: ordering calendar).';
create index vendor_order_windows_vendor_idx on public.vendor_order_windows (vendor_id);
create trigger vendor_order_windows_org before insert or update on public.vendor_order_windows for each row execute function public.set_org_from_vendor();
create trigger vendor_order_windows_set_updated_at before update on public.vendor_order_windows for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- notes, activity log, review queue (polymorphic: entity_type + entity_id)
-- ---------------------------------------------------------------------------
create table public.notes (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  entity_type      text not null,
  entity_id        uuid not null,
  body             text not null,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index notes_entity_idx on public.notes (organization_id, entity_type, entity_id, created_at desc);
create trigger notes_set_updated_at before update on public.notes for each row execute function public.set_updated_at();

create table public.activity_log (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  entity_type      text not null,
  entity_id        uuid,
  action           text not null,
  details          jsonb not null default '{}'::jsonb,
  actor_id         uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index activity_log_entity_idx on public.activity_log (organization_id, entity_type, entity_id, created_at desc);
create index activity_log_recent_idx on public.activity_log (organization_id, created_at desc);

create table public.review_items (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  kind             text not null,                      -- vendor_duplicate, vendor_merge, vendor_new, enrichment, vendor_form, invoice_upload, ...
  entity_type      text,
  entity_id        uuid,
  title            text not null,
  details          jsonb not null default '{}'::jsonb,  -- what was found / proposed
  status           public.review_status not null default 'pending',
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  resolved_by      uuid references public.profiles(id) on delete set null,
  resolved_at      timestamptz,
  resolution_note  text
);
comment on table public.review_items is 'The review queue: anything the system is not confident about waits here for a person (spec §5, decisions log).';
create index review_items_pending_idx on public.review_items (organization_id, status, created_at desc);
create index review_items_entity_idx on public.review_items (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.categories            enable row level security;
alter table public.rep_groups            enable row level security;
alter table public.payment_terms         enable row level security;
alter table public.vendors               enable row level security;
alter table public.vendor_billing_routes enable row level security;
alter table public.vendor_emails         enable row level security;
alter table public.vendor_stores         enable row level security;
alter table public.vendor_categories     enable row level security;
alter table public.vendor_order_windows  enable row level security;
alter table public.notes                 enable row level security;
alter table public.activity_log          enable row level security;
alter table public.review_items          enable row level security;

-- Reference tables: members read; admins manage.
create policy "categories: members read" on public.categories for select to authenticated using (public.user_in_org(organization_id));
create policy "categories: admins insert" on public.categories for insert to authenticated with check (public.is_admin() and public.user_in_org(organization_id));
create policy "categories: admins update" on public.categories for update to authenticated using (public.is_admin() and public.user_in_org(organization_id)) with check (public.is_admin() and public.user_in_org(organization_id));

create policy "rep_groups: members read" on public.rep_groups for select to authenticated using (public.user_in_org(organization_id));
create policy "rep_groups: editors insert" on public.rep_groups for insert to authenticated with check (public.user_can_edit() and public.user_in_org(organization_id));
create policy "rep_groups: editors update" on public.rep_groups for update to authenticated using (public.user_can_edit() and public.user_in_org(organization_id)) with check (public.user_can_edit() and public.user_in_org(organization_id));

create policy "payment_terms: members read" on public.payment_terms for select to authenticated using (public.user_in_org(organization_id));
create policy "payment_terms: admins insert" on public.payment_terms for insert to authenticated with check (public.is_admin() and public.user_in_org(organization_id));
create policy "payment_terms: admins update" on public.payment_terms for update to authenticated using (public.is_admin() and public.user_in_org(organization_id)) with check (public.is_admin() and public.user_in_org(organization_id));

-- Vendors and children: members read; editors write; child rows deletable by editors.
create policy "vendors: members read" on public.vendors for select to authenticated using (public.user_in_org(organization_id));
create policy "vendors: editors insert" on public.vendors for insert to authenticated with check (public.user_can_edit() and public.user_in_org(organization_id));
create policy "vendors: editors update" on public.vendors for update to authenticated using (public.user_can_edit() and public.user_in_org(organization_id)) with check (public.user_can_edit() and public.user_in_org(organization_id));

create policy "vendor_billing_routes: members read" on public.vendor_billing_routes for select to authenticated using (public.user_in_org(organization_id));
create policy "vendor_billing_routes: editors write" on public.vendor_billing_routes for all to authenticated using (public.user_can_edit() and public.user_in_org(organization_id)) with check (public.user_can_edit() and public.user_in_org(coalesce(organization_id, (select v.organization_id from public.vendors v where v.id = vendor_id))));

create policy "vendor_emails: members read" on public.vendor_emails for select to authenticated using (public.user_in_org(organization_id));
create policy "vendor_emails: editors write" on public.vendor_emails for all to authenticated using (public.user_can_edit() and public.user_in_org(organization_id)) with check (public.user_can_edit() and public.user_in_org(coalesce(organization_id, (select v.organization_id from public.vendors v where v.id = vendor_id))));

create policy "vendor_stores: members read" on public.vendor_stores for select to authenticated using (public.user_in_org(organization_id));
create policy "vendor_stores: editors write" on public.vendor_stores for all to authenticated using (public.user_can_edit() and public.user_in_org(organization_id)) with check (public.user_can_edit() and public.user_in_org(coalesce(organization_id, (select v.organization_id from public.vendors v where v.id = vendor_id))));

create policy "vendor_categories: members read" on public.vendor_categories for select to authenticated using (public.user_in_org(organization_id));
create policy "vendor_categories: editors write" on public.vendor_categories for all to authenticated using (public.user_can_edit() and public.user_in_org(organization_id)) with check (public.user_can_edit() and public.user_in_org(coalesce(organization_id, (select v.organization_id from public.vendors v where v.id = vendor_id))));

create policy "vendor_order_windows: members read" on public.vendor_order_windows for select to authenticated using (public.user_in_org(organization_id));
create policy "vendor_order_windows: editors write" on public.vendor_order_windows for all to authenticated using (public.user_can_edit() and public.user_in_org(organization_id)) with check (public.user_can_edit() and public.user_in_org(coalesce(organization_id, (select v.organization_id from public.vendors v where v.id = vendor_id))));

-- Notes: members read; editors add; author or admin edits/deletes.
create policy "notes: members read" on public.notes for select to authenticated using (public.user_in_org(organization_id));
create policy "notes: editors insert" on public.notes for insert to authenticated with check (public.user_can_edit() and public.user_in_org(organization_id) and created_by = auth.uid());
create policy "notes: author or admin update" on public.notes for update to authenticated using (public.user_in_org(organization_id) and (created_by = auth.uid() or public.is_admin())) with check (public.user_in_org(organization_id));
create policy "notes: author or admin delete" on public.notes for delete to authenticated using (public.user_in_org(organization_id) and (created_by = auth.uid() or public.is_admin()));

-- Activity log: members read; editors append; immutable.
create policy "activity_log: members read" on public.activity_log for select to authenticated using (public.user_in_org(organization_id));
create policy "activity_log: editors insert" on public.activity_log for insert to authenticated with check (public.user_can_edit() and public.user_in_org(organization_id));

-- Review queue: members read; editors create and resolve.
create policy "review_items: members read" on public.review_items for select to authenticated using (public.user_in_org(organization_id));
create policy "review_items: editors insert" on public.review_items for insert to authenticated with check (public.user_can_edit() and public.user_in_org(organization_id));
create policy "review_items: editors update" on public.review_items for update to authenticated using (public.user_can_edit() and public.user_in_org(organization_id)) with check (public.user_can_edit() and public.user_in_org(organization_id));

-- ---------------------------------------------------------------------------
-- Grants (explicit, see migration 0002)
-- ---------------------------------------------------------------------------
revoke all on table
  public.categories, public.rep_groups, public.payment_terms, public.vendors,
  public.vendor_billing_routes, public.vendor_emails, public.vendor_stores, public.vendor_categories,
  public.vendor_order_windows, public.notes, public.activity_log, public.review_items
from anon, authenticated;

grant select, insert, update on table public.categories, public.rep_groups, public.payment_terms, public.vendors, public.review_items to authenticated;
grant select, insert, update, delete on table public.vendor_billing_routes, public.vendor_emails, public.vendor_stores, public.vendor_categories, public.vendor_order_windows, public.notes to authenticated;
grant select, insert on table public.activity_log to authenticated;

grant all on table
  public.categories, public.rep_groups, public.payment_terms, public.vendors,
  public.vendor_billing_routes, public.vendor_emails, public.vendor_stores, public.vendor_categories,
  public.vendor_order_windows, public.notes, public.activity_log, public.review_items
to service_role;

-- ---------------------------------------------------------------------------
-- Seed: payment terms for organization #1
-- ---------------------------------------------------------------------------
insert into public.payment_terms (organization_id, name, days_until_due, discount_percent, discount_days, is_default, sort_order)
values
  ('00000000-0000-0000-0000-000000000001', 'Due on receipt', 0,  null, null, false, 1),
  ('00000000-0000-0000-0000-000000000001', 'Net 15',         15, null, null, false, 2),
  ('00000000-0000-0000-0000-000000000001', 'Net 30',         30, null, null, true,  3),
  ('00000000-0000-0000-0000-000000000001', 'Net 45',         45, null, null, false, 4),
  ('00000000-0000-0000-0000-000000000001', 'Net 60',         60, null, null, false, 5),
  ('00000000-0000-0000-0000-000000000001', '2% 10 Net 30',   30, 2.00, 10,   false, 6)
on conflict do nothing;
