\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Planet Cotton: the design below the garments'
reset role;
select count(*) <= 1 as rule_set_when_planet_cotton_exists from public.vendors where id = '8ddde2cd-7328-45b6-8219-b10a8bf97587' and vendor_id_rule like '%first DESIGN line below it%' and not vid_in_description;
