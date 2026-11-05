\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0310: alternate rep'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'AR310 GOGGLES') returning id as v \gset
insert into public.rep_groups (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'AR310 Reps') returning id as g \gset
insert into public.rep_group_contacts (organization_id, rep_group_id, name, email) values ('00000000-0000-0000-0000-000000000001', :'g', 'Main Person', 'main@ar310.example') returning id as gm \gset
insert into public.rep_group_contacts (organization_id, rep_group_id, name, email) values ('00000000-0000-0000-0000-000000000001', :'g', 'Alt Person', 'alt@ar310.example') returning id as ga \gset
insert into public.vendor_emails (organization_id, vendor_id, email, contact_type, roles, source)
values ('00000000-0000-0000-0000-000000000001', :'v', 'own@ar310.example', 'rep', array['rep']::public.contact_type[], 'manual') returning id as own \gset
update public.vendors set rep_group_id = :'g', assigned_rep_group_contact_id = :'gm', alternate_rep_group_contact_id = :'ga' where id = :'v';

\echo '>>> main and alternate side by side'
select assigned_rep_group_contact_id = :'gm' and alternate_rep_group_contact_id = :'ga' as both_set from public.vendors where id = :'v';

\echo '>>> one alternate: picking the vendor''s own person replaces the rep group one'
update public.vendors set alternate_rep_contact_id = :'own' where id = :'v';
select alternate_rep_contact_id = :'own' and alternate_rep_group_contact_id is null as one_alternate from public.vendors where id = :'v';
update public.vendors set alternate_rep_contact_id = null, alternate_rep_group_contact_id = :'ga' where id = :'v';

\echo '>>> making the alternate the main rep clears the alternate'
update public.vendors set assigned_rep_group_contact_id = :'ga' where id = :'v';
select assigned_rep_group_contact_id = :'ga' and alternate_rep_group_contact_id is null as alt_cleared from public.vendors where id = :'v';

\echo '>>> someone marked former is no longer the alternate'
update public.vendors set assigned_rep_group_contact_id = :'gm', alternate_rep_group_contact_id = :'ga' where id = :'v';
update public.rep_group_contacts set former_at = now() where id = :'ga';
select alternate_rep_group_contact_id is null as former_cleared from public.vendors where id = :'v';
update public.vendors set alternate_rep_contact_id = :'own' where id = :'v';
update public.vendor_emails set former_at = now() where id = :'own';
select alternate_rep_contact_id is null as own_former_cleared from public.vendors where id = :'v';

\echo '>>> deleted contact: the alternate goes too'
update public.vendor_emails set former_at = null where id = :'own';
update public.vendors set alternate_rep_contact_id = :'own' where id = :'v';
update public.vendors set assigned_rep_contact_id = null where id = :'v';
delete from public.vendor_emails where id = :'own';
select alternate_rep_contact_id is null as deleted_cleared from public.vendors where id = :'v';

update public.vendors set assigned_rep_group_contact_id = null, alternate_rep_group_contact_id = null, rep_group_id = null where id = :'v';
delete from public.rep_group_contacts where rep_group_id = :'g';
delete from public.vendors where id = :'v';
delete from public.rep_groups where id = :'g';
