-- =============================================================================
-- 0012 — Billing partners and their contacts (Dana, 2026-10-06: "an info box for all
-- WWD vendors that lists our contact info with WWD", member #816, AR contact Arsenia).
-- A partner is the organisation behind a billing route (Worldwide, Faire). Its contacts
-- are the people on their roster; show_on_vendor marks the few to show in the box.
-- =============================================================================
create table if not exists public.partners (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  route           public.billing_route not null,
  name            text not null,
  member_number   text,
  main_phone      text,
  website         text,
  address         text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, route)
);
comment on table public.partners is 'The company behind a billing route (Worldwide Distributors, Faire) and our account with them.';

create table if not exists public.partner_contacts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  partner_id      uuid not null references public.partners(id) on delete cascade,
  name            text not null,
  department      text,
  title           text,
  extension       text,
  phone           text,
  email           text,
  member_range    text,                       -- "763-893": which member numbers this person handles
  initial_range   text,                       -- "A-L": vendor liaison by vendor initial
  show_on_vendor  boolean not null default false,
  sort_order      int not null default 100,
  notes           text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
comment on table public.partner_contacts is 'People at a billing partner. show_on_vendor = appears in the contact box on WWD vendor pages.';
create unique index if not exists partner_contacts_email_key on public.partner_contacts (partner_id, lower(email)) where email is not null;
create index if not exists partner_contacts_partner_idx on public.partner_contacts (partner_id, sort_order);

drop trigger if exists partners_touch on public.partners;
create trigger partners_touch before update on public.partners for each row execute function public.set_updated_at();
drop trigger if exists partner_contacts_touch on public.partner_contacts;
create trigger partner_contacts_touch before update on public.partner_contacts for each row execute function public.set_updated_at();

alter table public.partners enable row level security;
alter table public.partner_contacts enable row level security;
drop policy if exists "partners: members read" on public.partners;
drop policy if exists "partners: editors write" on public.partners;
drop policy if exists "partner_contacts: members read" on public.partner_contacts;
drop policy if exists "partner_contacts: editors write" on public.partner_contacts;
create policy "partners: members read" on public.partners for select to authenticated using (public.user_in_org(organization_id));
create policy "partners: editors write" on public.partners for all to authenticated
  using (public.user_can_edit() and public.user_in_org(organization_id)) with check (public.user_can_edit() and public.user_in_org(organization_id));
create policy "partner_contacts: members read" on public.partner_contacts for select to authenticated using (public.user_in_org(organization_id));
create policy "partner_contacts: editors write" on public.partner_contacts for all to authenticated
  using (public.user_can_edit() and public.user_in_org(organization_id)) with check (public.user_can_edit() and public.user_in_org(organization_id));
grant select, insert, update, delete on table public.partners, public.partner_contacts to authenticated;
grant all on table public.partners, public.partner_contacts to service_role;
