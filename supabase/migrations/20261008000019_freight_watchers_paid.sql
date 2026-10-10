-- 0040 — Dana sees everything Trevor sees in freight while he is new (Oct 8), and freight bills are paid.
-- profiles.sees_freight: freight conversations show under that person's Mine and Mail for you, and the
-- freight bills on the dashboard, besides the carrier's owner (Trevor). Admins switch it in Settings > Mail.
alter table public.profiles add column if not exists sees_freight boolean not null default false;
comment on column public.profiles.sees_freight is 'Also sees all freight mail and freight bills (Dana while Trevor is new). Admins set it.';
update public.profiles set sees_freight = true where role = 'admin' and is_active;

-- Paying a freight bill (Dana pays the bills).
alter table public.freight_bills add column if not exists paid_date date;
alter table public.freight_bills add column if not exists paid_via text check (paid_via is null or paid_via in ('card', 'check', 'ach', 'billcom', 'other'));
alter table public.freight_bills add column if not exists paid_ref text;
alter table public.freight_bills add column if not exists paid_by uuid references public.profiles(id) on delete set null;
create index if not exists freight_bills_unpaid_idx on public.freight_bills (organization_id, due_date) where paid_date is null;
