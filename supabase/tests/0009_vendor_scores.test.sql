\set ON_ERROR_STOP on
\pset footer off
\echo '>>> vendor scores: three orders (two on time, one late with a damage note and freight), one credit resolved; automatic scores'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
insert into public.vendors (organization_id, name, free_shipping_policy, free_shipping_threshold) values ('00000000-0000-0000-0000-000000000001', 'Score Test Co', 'sometimes', 500) returning id as sv \gset
insert into public.orders (organization_id, vendor_id, order_date, est_ship_date, date_received, est_cost, freight_cost, source, source_key) values
  ('00000000-0000-0000-0000-000000000001', :'sv', '2026-02-01', '2026-03-01', '2026-03-04', 600, 0, 'manual', 'sc1'),
  ('00000000-0000-0000-0000-000000000001', :'sv', '2026-02-10', '2026-03-10', '2026-03-12', 300, 30, 'manual', 'sc2');
insert into public.orders (organization_id, vendor_id, order_date, est_ship_date, date_received, est_cost, freight_cost, shipment_notes, credits_due, date_credits_received, source, source_key) values
  ('00000000-0000-0000-0000-000000000001', :'sv', '2026-02-20', '2026-03-20', '2026-04-15', 800, 120, 'two boxes damaged, short shipped', true, '2026-04-30', 'manual', 'sc3');
select orders, received, on_time, late, avg_days_late, freight_pct, free_violations, issue_notes, accuracy_issues, credits_due, credits_resolved, avg_credit_days, auto_fulfilment, auto_accuracy, auto_shipping, auto_resolution, overall
  from public.vendor_scorecards('00000000-0000-0000-0000-000000000001', :'sv');
\echo '>>> a hand rating wins over the automatic score and feeds the overall'
insert into public.vendor_ratings (organization_id, vendor_id, dimension, score, note, rated_by) values ('00000000-0000-0000-0000-000000000001', :'sv', 'fulfilment', 2, 'Always late in spring', '22222222-2222-2222-2222-222222222222');
insert into public.vendor_ratings (organization_id, vendor_id, dimension, score, note, rated_by) values ('00000000-0000-0000-0000-000000000001', :'sv', 'communication', 5, 'Rep answers same day', '22222222-2222-2222-2222-222222222222');
select rated_fulfilment, note_fulfilment, rated_communication, auto_fulfilment, overall from public.vendor_scorecards('00000000-0000-0000-0000-000000000001', :'sv');
\echo '>>> a vendor with no orders has no automatic scores and no overall'
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Score Empty Co') returning id as se \gset
select orders, auto_fulfilment, auto_accuracy, auto_shipping, auto_resolution, overall from public.vendor_scorecards('00000000-0000-0000-0000-000000000001', :'se');
\echo '>>> viewer cannot rate (expect 1 error)'
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', false);
\set ON_ERROR_STOP off
insert into public.vendor_ratings (organization_id, vendor_id, dimension, score) values ('00000000-0000-0000-0000-000000000001', :'sv', 'ease', 3);
\set ON_ERROR_STOP on
reset role;
