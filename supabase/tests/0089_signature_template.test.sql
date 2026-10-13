\set ON_ERROR_STOP on
\pset footer off
\echo '>>> signature template set; the simple signatures move into name and title'
reset role;
update public.profiles set email_signature = E'Pat Example\nShaver Lake Sports\nBuyer' where id = '22222222-2222-2222-2222-222222222222';
update public.profiles set signature_name = split_part(email_signature, E'\n', 1), job_title = split_part(email_signature, E'\n', 3), email_signature = null
 where email_signature ~ E'^[^\n]+\nShaver Lake Sports\n[^\n]+$' and id = '22222222-2222-2222-2222-222222222222';
select signature_name, job_title, email_signature is null as template from public.profiles where id = '22222222-2222-2222-2222-222222222222';
select signature_template like '%{name}%' as has_template from public.organizations where id = '00000000-0000-0000-0000-000000000001';
