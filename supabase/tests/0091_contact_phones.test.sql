\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Phones: text becomes typed numbers; phone stays the first number'
reset role;
select public.phones_from_text('Cell: 208-969-9739  Office:  559-977-1402') as two,
       public.phones_from_text('619-804-8779 Cell') as cell_after,
       public.phones_from_text('(800) 541-2929 x12') as ext,
       public.phones_from_text('Fax 559.841.2741') as fax;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Phones Test Vendor') returning id as v \gset
insert into public.vendor_emails (vendor_id, email, phone) values (:'v', 'pat@phones.example', 'Cell: 208-969-9739  Office:  559-977-1402') returning id as c \gset
select phone, jsonb_array_length(phones) as n from public.vendor_emails where id = :'c';
update public.vendor_emails set phones = '[{"number":"559-555-0101","type":"other","label":"Warehouse"},{"number":"559-555-0102","type":"cell"}]' where id = :'c';
select phone, phones -> 0 ->> 'label' as label from public.vendor_emails where id = :'c';
update public.vendor_emails set phone = null where id = :'c';
select phone is null as cleared, phones = '[]'::jsonb as no_phones from public.vendor_emails where id = :'c';
delete from public.vendors where id = :'v';
