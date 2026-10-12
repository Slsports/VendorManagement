\set ON_ERROR_STOP on
\pset footer off
\echo '>>> a contact can be Rep and Owner; the main kind is Rep'
reset role;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Roles Test Vendor') returning id as v \gset
insert into public.vendor_emails (organization_id, vendor_id, contact_name, roles) values ('00000000-0000-0000-0000-000000000001', :'v', 'Barry', array['owner', 'rep']::public.contact_type[]) returning id as c \gset
select contact_type, roles from public.vendor_emails where id = :'c';
insert into public.vendor_emails (organization_id, vendor_id, contact_name, contact_type) values ('00000000-0000-0000-0000-000000000001', :'v', 'Old style', 'orders') returning id as c2 \gset
select contact_type, roles from public.vendor_emails where id = :'c2';
update public.vendor_emails set roles = array['ap']::public.contact_type[] where id = :'c';
select contact_type, roles from public.vendor_emails where id = :'c';
