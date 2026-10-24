\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Texting hours: 8 am to 6 pm unless the person sets their own'
reset role;
select text_from = '08:00' and text_until = '18:00' as default_hours from public.profiles where id = '11111111-1111-1111-1111-111111111111';
-- a person sets their own
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as dana_in;
set role authenticated;
update public.profiles set text_from = '07:00', text_until = '20:00' where id = '11111111-1111-1111-1111-111111111111';
reset role;
select text_from = '07:00' and text_until = '20:00' as own_hours from public.profiles where id = '11111111-1111-1111-1111-111111111111';
update public.profiles set text_from = '08:00', text_until = '18:00' where id = '11111111-1111-1111-1111-111111111111';
