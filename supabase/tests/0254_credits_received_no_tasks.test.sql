\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0254: a credit is filed and marked Received, with no task; moved out of Credits it is not Received'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'CR254 VENDOR') returning id as v \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, received_at) values
  ('00000000-0000-0000-0000-000000000001', :'v', 'credit', 'Credit CM254', 'x/cr254.pdf', current_date - 2) returning id as c \gset
select credit_received_on = current_date - 2 as received from public.vendor_links where id = :'c';
select count(*) = 0 as no_task from public.tasks where auto_key = 'credit:' || :'c';
update public.vendor_links set kind = 'other' where id = :'c';
select credit_received_on is null as not_a_credit from public.vendor_links where id = :'c';
delete from public.vendor_links where vendor_id = :'v';
delete from public.vendors where id = :'v';
