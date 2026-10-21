\set ON_ERROR_STOP on
\pset footer off
\echo '>>> The orders behind a vendor''s automatic scores'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'SCORE221') returning id as v \gset
insert into public.orders (organization_id, vendor_id, status, po_number, order_date, est_ship_date, date_received, shipment_notes, credits_due) values
  ('00000000-0000-0000-0000-000000000001', :'v', 'entered', 'LATE1', '2026-01-01', '2026-02-01', '2026-03-01', 'box crushed, 2 broken', true),
  ('00000000-0000-0000-0000-000000000001', :'v', 'entered', 'OK1', '2026-01-05', '2026-02-01', '2026-02-03', null, false);
select count(*) = 1 and bool_and(po_number = 'LATE1' and why like 'received 28 days%') as late_listed from public.vendor_score_orders(:'v', 'fulfilment');
select count(*) = 1 as damage_listed from public.vendor_score_orders(:'v', 'accuracy');
select count(*) = 1 and bool_and(why like 'credit still owed%') as credit_listed from public.vendor_score_orders(:'v', 'resolution');
select count(*) = 0 as unknown_empty from public.vendor_score_orders(:'v', 'ease');
delete from public.orders where vendor_id = :'v';
delete from public.vendors where id = :'v';
