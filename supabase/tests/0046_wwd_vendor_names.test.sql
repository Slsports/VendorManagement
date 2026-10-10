\set ON_ERROR_STOP on
\pset footer off
\echo '>>> WWD vendor names: a short VMS name the WWD name starts with; the longest wins; a lone word does not'
reset role;
insert into public.vendors (organization_id, name, aliases) values ('00000000-0000-0000-0000-000000000001', 'DAISYTEST', array['DAISYTEST - WWD']) returning id as d \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'FRANKTEST') returning id as f1 \gset
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'FRANKTEST SPORTS') returning id as f2 \gset
select public.wwd_vendor_for('00000000-0000-0000-0000-000000000001', 'Daisytest Outdoor Products') = :'d' as daisy,
       public.wwd_vendor_for('00000000-0000-0000-0000-000000000001', 'Franktest Sports Industries') = :'f2' as longest,
       public.wwd_vendor_for('00000000-0000-0000-0000-000000000001', 'Daisytestx Corp') is null as not_part_of_word,
       public.wwd_words('G Pucci & Sons, Inc.') as words;
