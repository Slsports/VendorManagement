\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0306: text alert categories'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select (select data_type from information_schema.columns where table_name = 'profiles' and column_name = 'text_categories') = 'ARRAY' as profile_column,
       (select data_type from information_schema.columns where table_name = 'tasks' and column_name = 'text_me') = 'boolean' as task_column;
select coalesce(bool_and(text_categories is not null), true) as never_null from public.profiles;
