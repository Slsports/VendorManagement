-- 0156 — Lightspeed access level (bug, Oct 18): LS's token answer carries no scope, so lightspeed_connections.scope stayed
-- null and Settings › Lightspeed always said "read only", even after a Full reconnect. The access asked for at Connect
-- time is kept here and copied into scope once the sign-in completes.
alter table public.lightspeed_connections add column if not exists oauth_scope text;
comment on column public.lightspeed_connections.oauth_scope is 'The access asked for when Connect was clicked (employee:all for Full); copied into scope after the sign-in.';
