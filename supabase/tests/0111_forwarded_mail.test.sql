\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Forwarded mail: our own addresses are internal senders, and an email keeps who it was forwarded from'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
select 'shaverlakesports@gmail.com' = any (own_addresses) as old_gmail_is_ours from public.organizations where id = '00000000-0000-0000-0000-000000000001';
select count(*) = 0 as no_unknown_own_senders from public.email_senders s join public.organizations o on o.id = s.organization_id
 where s.sender_key = any (o.own_addresses) and s.kind = 'unknown';
select column_name from information_schema.columns where table_name = 'emails' and column_name in ('forwarded_from', 'forwarded_name') order by 1;
