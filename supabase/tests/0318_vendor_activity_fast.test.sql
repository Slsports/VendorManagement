\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Activity feed: the vendor''s conversations by vendor and by tag, only in your company; private mail still private (0204 test covers the list)'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into auth.users (id, email) values ('31831800-0000-0000-0000-000000000001', 'vf-a@example.com') on conflict do nothing;
insert into public.profiles (id, organization_id, email, full_name, role) values
  ('31831800-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'vf-a@example.com', 'Vf A', 'buyer')
on conflict (id) do nothing;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'VF318 MAIN') returning id as v \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'VF318 OTHER') returning id as v2 \gset
insert into public.email_threads (organization_id, gmail_thread_id, vendor_id, view) values ('00000000-0000-0000-0000-000000000001', 'vf318-a', :'v', 'attention') returning id as ta \gset
insert into public.email_threads (organization_id, gmail_thread_id, vendor_id, tagged_vendor_ids, view) values ('00000000-0000-0000-0000-000000000001', 'vf318-t', :'v2', array[:'v']::uuid[], 'attention') returning id as tt \gset
insert into public.email_threads (organization_id, gmail_thread_id, vendor_id, view) values ('00000000-0000-0000-0000-000000000001', 'vf318-o', :'v', 'offers') returning id as tof \gset
insert into public.email_threads (organization_id, gmail_thread_id, vendor_id, view, deleted_at) values ('00000000-0000-0000-0000-000000000001', 'vf318-d', :'v', 'attention', now()) returning id as td \gset

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"31831800-0000-0000-0000-000000000001","role":"authenticated"}', false) is not null as a_in;
select public.vendor_thread_ids(:'v') @> array[:'ta', :'tt']::uuid[] and cardinality(public.vendor_thread_ids(:'v')) = 2 as by_vendor_and_tag;
-- someone not signed in to this company gets nothing
select set_config('request.jwt.claims', '{"sub":"31831800-0000-0000-0000-0000000000ff","role":"authenticated"}', false) is not null as stranger_in;
select cardinality(public.vendor_thread_ids(:'v')) = 0 as stranger_none;
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
