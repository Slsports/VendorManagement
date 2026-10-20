\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Pay-by reminder titles carry the year'
reset role;
select position('''Mon FMDD'')' in pg_get_functiondef('public.sync_payment_tasks(uuid)'::regprocedure)) = 0
   and position('''Mon FMDD, YYYY'')' in pg_get_functiondef('public.sync_payment_tasks(uuid)'::regprocedure)) > 0 as titles_with_year;
select to_char(date '2026-10-26', 'Mon FMDD, YYYY') = 'Oct 26, 2026' as format_ok;
