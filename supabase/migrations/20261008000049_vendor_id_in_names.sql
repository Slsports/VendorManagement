-- 0070 — Vendor ID in item names (Dana, Oct 10): for some vendors the Vendor ID at the end of the item
-- description is how we find things, for others it only gets in the way. The vendor sets the default
-- ("Add Vendor ID to item descriptions"), an order can change it before its PO is made, and one item can
-- differ from its order. When on, the name ends with the Vendor ID in brackets: "MENS HOODIE NAVY [AB1234]".
-- The Lightspeed clean-up follows the same setting; nothing changes in Lightspeed without an approved batch.
alter table public.vendors add column if not exists vid_in_description boolean not null default false;
alter table public.orders add column if not exists vid_in_description boolean;
alter table public.order_lines add column if not exists vid_in_description boolean;
comment on column public.orders.vid_in_description is 'null = the vendor''s setting';
comment on column public.order_lines.vid_in_description is 'null = the order''s setting';
