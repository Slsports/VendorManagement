-- 0015 — Fishing vendor flag (Dana, 2026-10-06: "I'd like a flag for fishing vendors").
-- Jarrett runs every fishing report; the flag drives the vendor filter and the fishing report list.
alter table public.vendors add column if not exists is_fishing boolean not null default false;
comment on column public.vendors.is_fishing is 'Fishing vendor: tackle, bait, rods, fly fishing. Jarrett runs these reports.';
create index if not exists vendors_fishing_idx on public.vendors (organization_id) where is_fishing;
