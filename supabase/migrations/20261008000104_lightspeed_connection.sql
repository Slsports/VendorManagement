-- 0104 — Connecting VMS to Lightspeed (Dana, Oct 13: "Go!"). Settings → Lightspeed (admin): Dana pastes the Client ID and
-- Client Secret of the API client she registers ("SLS VMS 2", redirect https://vms.shaverlakesports.com/integrations/
-- lightspeed/callback), then clicks Connect to Lightspeed, signs in to LS and approves. VMS keeps the keys and the sign-in
-- tokens here, out of reach of every signed-in user (no grants, no policies): only the lightspeed edge function (service
-- role) reads them, and the page only ever sees whether they are set. VMS reads from LS; nothing in LS changes until each
-- batch is approved (CLAUDE.md).
create table if not exists public.lightspeed_connections (
  organization_id   uuid primary key references public.organizations(id) on delete cascade,
  client_id         text,
  client_secret     text,
  scope             text,
  account_id        text,
  account_name      text,
  access_token      text,
  access_expires_at timestamptz,
  refresh_token     text,
  connected_at      timestamptz,
  connected_by      uuid references public.profiles(id) on delete set null,
  oauth_state       text,
  oauth_state_at    timestamptz,
  checked_at        timestamptz,
  item_count        integer,
  last_error        text,
  updated_at        timestamptz not null default now()
);
comment on table public.lightspeed_connections is 'The Lightspeed API client and sign-in for each organization. Secrets: service role only.';
alter table public.lightspeed_connections enable row level security;
revoke all on table public.lightspeed_connections from public, anon, authenticated;
grant all on table public.lightspeed_connections to service_role;
drop trigger if exists lightspeed_connections_updated_at on public.lightspeed_connections;
create trigger lightspeed_connections_updated_at before update on public.lightspeed_connections for each row execute function public.set_updated_at();
