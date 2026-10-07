\set ON_ERROR_STOP on
\pset footer off
\echo '>>> orders by hand: JW adds a card-paid order and ties the conversation to it; paid by check is allowed'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Hat Test Co') returning id as hv \gset
insert into public.orders (organization_id, vendor_id, status, order_date, description, placed_by, final_cost, paid_date, paid_via, source)
values ('00000000-0000-0000-0000-000000000001', :'hv', 'paid', current_date, '48 trucker hats', 'Tyler', 612.50, current_date, 'card', 'manual') returning id as ho \gset
update public.orders set paid_via = 'check' where id = :'ho' returning paid_via;
reset role;
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'hat-thread') returning id as ht \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, received_at) values ('00000000-0000-0000-0000-000000000001', 'hat-1', :'ht', 'internal', now()), ('00000000-0000-0000-0000-000000000001', 'hat-2', :'ht', 'in', now());
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
select public.link_email_thread_order(:'ht', :'ho');
select count(*) as linked from public.emails where order_id = :'ho';
reset role;
