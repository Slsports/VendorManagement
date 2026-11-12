-- Vendors whose prices are set by them for the season (Dana, Nov 12: "Remove checking pricing from snow park. It is the
-- same all season. If they change it, it would be before the season starts and we would adjust it before we get any
-- orders"). vendors.fixed_prices: no Check-in pricing or sales-report cards on their orders.
alter table public.vendors add column if not exists fixed_prices boolean not null default false;
comment on column public.vendors.fixed_prices is 'Their prices are set for the season (the State for Sno-Park permits): no check-in pricing on their orders.';
update public.vendors set fixed_prices = true where upper(name) like '%SNO%PARK%' and merged_into_id is null;
