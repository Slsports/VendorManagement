\set ON_ERROR_STOP on
\pset footer off
\echo '>>> a deleted conversation comes back when a new message arrives'
reset role;
insert into public.email_threads (organization_id, gmail_thread_id) values ('00000000-0000-0000-0000-000000000001', 'del1') returning id as dt \gset
select public.mark_threads_deleted(array[:'dt']::uuid[], '22222222-2222-2222-2222-222222222222', true) as deleted;
select deleted_at is not null as is_deleted from public.email_threads where id = :'dt';
insert into public.emails (organization_id, gmail_id, thread_id, direction, from_email, subject, received_at) values ('00000000-0000-0000-0000-000000000001', 'delm1', :'dt', 'in', 'rep@x.example', 'Re: hello', now());
select deleted_at is null as back from public.email_threads where id = :'dt';
