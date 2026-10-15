\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Proofs: proof files from email go to Proofs; Mark approved stars them; a hand move is kept'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Proof Test Co') returning id as v \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url, file_name, source)
values ('00000000-0000-0000-0000-000000000001', :'v', 'other', 'R6886 SL Mountain_JO-03132_PROOF', 'https://x/p.pdf', 'R6886 SL Mountain_JO-03132_PROOF.pdf', 'email') returning id as p \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url, file_name, source)
values ('00000000-0000-0000-0000-000000000001', :'v', 'image', 'Art Approval V3-01', 'https://x/a.jpg', 'ShaverLake_Art Approval V3-01.jpg', 'email') returning id as a \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, url, file_name, source)
values ('00000000-0000-0000-0000-000000000001', :'v', 'image', 'Waterproof jacket', 'https://x/w.jpg', 'waterproof jacket.jpg', 'email') returning id as w \gset
select (select kind from public.vendor_links where id = :'p') as proof_pdf, (select kind from public.vendor_links where id = :'a') as art_approval,
       (select kind from public.vendor_links where id = :'w') as waterproof_stays_image;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as admin_in;
select public.vendor_link_proof_approve(:'p', true);
select kind, approved_at is not null as stamped, approved_by is not null as by_whom from public.vendor_links where id = :'p';
select public.vendor_link_proof_approve(:'p', false);
select kind, approved_at is null as cleared from public.vendor_links where id = :'p';
-- a person moving it to Other by hand: kept
update public.vendor_links set kind = 'other' where id = :'a';
select kind as moved_by_hand from public.vendor_links where id = :'a';
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
delete from public.vendor_links where vendor_id = :'v';
delete from public.vendors where id = :'v';
