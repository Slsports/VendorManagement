\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Planet Cotton: cut-off Item Codes in the rule'
reset role;
select count(*) = 0 as no_rule_without_cut_off from public.vendors where id = '8ddde2cd-7328-45b6-8219-b10a8bf97587' and vendor_id_rule not like '%cut off on the paper%';
