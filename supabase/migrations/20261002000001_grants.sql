-- =============================================================================
-- 0002 — Explicit table privileges for the API roles
--
-- On this project, default privileges for the migration role do not give the
-- API roles (anon, authenticated, service_role) data access on new tables, only
-- truncate, references and trigger. RLS cannot help if the role has no SELECT
-- privilege at all, so every table must be granted explicitly.
--
-- Convention from here on: every migration that creates a table ends with the
-- grants for it. Grant to `authenticated` exactly what the RLS policies allow,
-- grant everything to `service_role` (server-side scripts), and nothing to `anon`.
-- =============================================================================

-- Strip the odd defaults (TRUNCATE is not covered by RLS and must never reach app users).
revoke all on table
  public.organizations, public.stores, public.profiles, public.user_store_access
from anon, authenticated;

-- authenticated: mirror the RLS policies in 0001.
grant select, update         on table public.organizations     to authenticated;
grant select, insert, update on table public.stores            to authenticated;
grant select, update         on table public.profiles          to authenticated;
grant select, insert, delete on table public.user_store_access to authenticated;

-- service_role: full access for admin scripts and server-side jobs (bypasses RLS).
grant all on table
  public.organizations, public.stores, public.profiles, public.user_store_access
to service_role;

-- The API roles need to use the schema (already true on Supabase; harmless to repeat).
grant usage on schema public to authenticated, service_role;
