\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0326: main shipping contact'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'MS326 TARPS') returning id as v \gset
insert into public.vendor_emails (organization_id, vendor_id, email, contact_type, roles, source)
values ('00000000-0000-0000-0000-000000000001', :'v', 'dock@ms326.example', 'orders', array['orders']::public.contact_type[], 'manual') returning id as c \gset

\echo '>>> picking them ticks Shipping'
update public.vendors set main_shipping_contact_id = :'c' where id = :'v';
select main_shipping_contact_id = :'c' as set_on_vendor from public.vendors where id = :'v';
select 'shipping' = any (roles) and 'orders' = any (roles) as shipping_ticked from public.vendor_emails where id = :'c';

\echo '>>> marked former: no longer the main shipping contact'
update public.vendor_emails set former_at = now() where id = :'c';
select main_shipping_contact_id is null as former_cleared from public.vendors where id = :'v';

delete from public.vendors where id = :'v';
