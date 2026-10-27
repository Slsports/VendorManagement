\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Proof and credit tasks only for paper that came in within 30 days'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'DT207 COTTON') returning id as v \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url, received_at) values ('00000000-0000-0000-0000-000000000001', :'v', 'proof', 'New', 'https://example.com/n.png', current_date - 2) returning id as l_new \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url, received_at) values ('00000000-0000-0000-0000-000000000001', :'v', 'proof', 'Old', 'https://example.com/o.png', current_date - 400) returning id as l_old \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url, received_at) values ('00000000-0000-0000-0000-000000000001', :'v', 'credit', 'Old credit', 'https://example.com/c.pdf', current_date - 90) returning id as l_oc \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url) values ('00000000-0000-0000-0000-000000000001', :'v', 'credit', 'Undated credit', 'https://example.com/u.pdf') returning id as l_un \gset
select exists (select 1 from public.tasks where auto_key = 'proof:' || :'l_new') as new_proof_task;
select not exists (select 1 from public.tasks where auto_key = 'proof:' || :'l_old') as old_proof_no_task;
select not exists (select 1 from public.tasks where auto_key = 'credit:' || :'l_oc') as old_credit_no_task;
select not exists (select 1 from public.tasks where auto_key = 'credit:' || :'l_un') as no_credit_task_since_0254;
-- an old picture re-sorted as a proof makes no task either
insert into public.vendor_links (organization_id, vendor_id, kind, label, url, received_at) values ('00000000-0000-0000-0000-000000000001', :'v', 'image', 'Pic', 'https://example.com/p.png', current_date - 200) returning id as l_pic \gset
update public.vendor_links set kind = 'proof' where id = :'l_pic';
select not exists (select 1 from public.tasks where auto_key = 'proof:' || :'l_pic') as old_resort_no_task;
-- approving a new proof still finishes its task
update public.vendor_links set kind = 'approved_proof' where id = :'l_new';
select done_at is not null as approve_finishes from public.tasks where auto_key = 'proof:' || :'l_new';
delete from public.tasks where auto_key in ('proof:' || :'l_new', 'credit:' || :'l_un');
delete from public.vendor_links where vendor_id = :'v';
delete from public.vendors where id = :'v';
