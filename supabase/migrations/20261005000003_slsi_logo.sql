-- =============================================================================
-- 0006 — Shaver Lake Sports logo (shipped with the app under public/brand/)
-- Tenant-uploaded logos will live in Storage later; this is organization #1's default.
-- =============================================================================
update public.organizations
set logo_url = '/brand/slsi-logo.png'
where id = '00000000-0000-0000-0000-000000000001';
