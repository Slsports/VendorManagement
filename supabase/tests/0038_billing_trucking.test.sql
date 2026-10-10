\set ON_ERROR_STOP on
\pset footer off
\echo '>>> billing vs trucking; WWD warehouse mail is WWD freight mail'
reset role;
select name, role from public.carriers where name in ('XPO', 'Oak Harbor Freight', 'Worldwide Distributors (WWD)', 'PartnerShip') order by name;
select id as tp from public.partners where organization_id = '00000000-0000-0000-0000-000000000001' and route = 'worldwide' \gset
insert into public.partner_contacts (organization_id, partner_id, name, department, email) values ('00000000-0000-0000-0000-000000000001', :'tp', 'Sue', 'Warehouse', 'sue@buygroup.example'), ('00000000-0000-0000-0000-000000000001', :'tp', 'Ann', 'Marketing', 'ann@buygroup.example');
insert into public.carriers (organization_id, name, mode, partner_id, partner_department) values ('00000000-0000-0000-0000-000000000001', 'Test Buy Group freight', 'ltl', :'tp', 'Warehouse') returning id as tc \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'bg1') returning id as t1 \gset
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'bg2') returning id as t2 \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at) values ('00000000-0000-0000-0000-000000000001', 'bgm1', :'t1', 'in', 'SUE@buygroup.example', 'merchandise ready to ship', now());
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at) values ('00000000-0000-0000-0000-000000000001', 'bgm2', :'t2', 'in', 'ann@buygroup.example', 'New flyer', now());
select (select carrier_id = :'tc' from public.email_threads where id = :'t1') as warehouse_is_freight, (select carrier_id is null from public.email_threads where id = :'t2') as marketing_is_not;
