\set ON_ERROR_STOP on
\pset footer off
\echo '>>> hold standing with a review date keeps the do-not-order flag off; discontinued_line and overstocked are valid tags'
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', false);
insert into public.vendors (organization_id, name, standing, standing_tags, standing_review_date) values ('00000000-0000-0000-0000-000000000001', 'Hold Test Co', 'hold', '{overstocked,discontinued_line}', '2027-01-15') returning standing, standing_tags, standing_review_date, do_not_order as flag;
reset role;
