-- 0085 — Each person's dashboard (Dana, Oct 11: "Is it possible for each ee to have the ability to see the
-- dashboard in different order of cards?"): their card order and hidden cards, saved to their login.
-- { "order": ["mail", "paperwork", …], "hidden": ["recent_activity"] }; null = the standard dashboard.
alter table public.profiles add column if not exists dashboard_layout jsonb;
