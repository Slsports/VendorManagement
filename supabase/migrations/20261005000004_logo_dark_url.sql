-- =============================================================================
-- 0007 — Logo variant for dark surfaces (sidebar, sign-in panel), per tenant.
-- =============================================================================
alter table public.organizations
  add column if not exists logo_dark_url text;

comment on column public.organizations.logo_dark_url is 'Logo for dark backgrounds (e.g. white-on-transparent). Falls back to logo_url on a white tile.';

update public.organizations
set logo_dark_url = '/brand/slsi-logo-white.png'
where id = '00000000-0000-0000-0000-000000000001';
