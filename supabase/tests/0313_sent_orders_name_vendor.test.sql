-- A sent email marked "no vendor" is back in the queue; an inbound one and an old one are not.
begin;
select '00000000-0000-0000-0000-000000000001'::uuid as org \gset
insert into public.email_threads (organization_id, gmail_thread_id) values (:'org', 't-0313') returning id as th \gset
insert into public.emails (id, organization_id, thread_id, gmail_id, direction, from_email, subject, received_at, order_scan, order_scanned_at)
values ('e0313000-0000-0000-0000-000000000001', :'org', :'th', 'g0313-1', 'out', 'orders@shaverlakesports.com', 'Order', now() - interval '2 days', '{"result":"no_vendor"}', now()),
       ('e0313000-0000-0000-0000-000000000002', :'org', :'th', 'g0313-2', 'in', 'ted@pariconsleds.com', 'Order', now() - interval '2 days', '{"result":"no_vendor"}', now()),
       ('e0313000-0000-0000-0000-000000000003', :'org', :'th', 'g0313-3', 'out', 'orders@shaverlakesports.com', 'Order', now() - interval '400 days', '{"result":"no_vendor"}', now());
update public.emails set order_scan = null, order_scanned_at = null
 where direction = 'out' and copy_of is null and order_scan->>'result' = 'no_vendor' and received_at > now() - interval '365 days';
do $$ begin
  if (select order_scan is not null or order_scanned_at is not null from public.emails where id = 'e0313000-0000-0000-0000-000000000001') then raise exception 'sent no-vendor email not re-queued'; end if;
  if (select order_scan is null from public.emails where id = 'e0313000-0000-0000-0000-000000000002') then raise exception 'inbound email was re-queued'; end if;
  if (select order_scan is null from public.emails where id = 'e0313000-0000-0000-0000-000000000003') then raise exception 'old email was re-queued'; end if;
end $$;
rollback;
