-- "staff" makes the sender ours with no card; a relaying service gets no person name; the back-check drops a minority name.
begin;
select '00000000-0000-0000-0000-000000000001'::uuid as org \gset
insert into public.email_senders (organization_id, sender_key, kind) values (:'org', 'former0331@gmail.com', 'unknown') returning id as s \gset
select set_config('t.s', :'s', false);
do $$ declare a text; begin
  a := public.mail_apply_sender_sort(current_setting('t.s')::uuid, 'staff', null, null, null, null, 'time cards and schedules', null);
  if a <> 'staff' then raise exception 'answer %', a; end if;
  if (select kind from public.email_senders where id = current_setting('t.s')::uuid) <> 'internal' then raise exception 'staff sender not internal'; end if;
end $$;
-- a contact whose person name is on a minority of its mail loses it in the back-check's rule
insert into public.accounting_contacts (organization_id, company, person, status) values (:'org', 'BILL', 'John Burton', 'proposed') returning id as c \gset
insert into public.accounting_contact_addresses (organization_id, address, is_domain, contact_id) values (:'org', 'relay0331.example', true, :'c');
insert into public.email_threads (organization_id, gmail_thread_id) values (:'org', 't-0331') returning id as th \gset
insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, from_name, subject, received_at)
values (:'org', :'th', 'g-0331-1', 'in', 'notice@relay0331.example', 'BILL', 'Payment sent', now()),
       (:'org', :'th', 'g-0331-2', 'in', 'notice@relay0331.example', 'BILL', 'Payment sent', now()),
       (:'org', :'th', 'g-0331-3', 'in', 'notice@relay0331.example', 'John Burton', 'Invoice', now());
with c as (select ct.id, ct.organization_id from public.accounting_contacts ct where ct.id = :'c'),
m as (select c.id, count(*) as n, count(*) filter (where e.from_name ~ '^[A-Z][a-z''-]+( [A-Z]\.?)? [A-Z][A-Za-z''-]+$') as person_n
        from c join public.accounting_contact_addresses a on a.contact_id = c.id
        join public.emails e on e.organization_id = c.organization_id and e.direction = 'in' and (lower(e.from_email) = a.address or (a.is_domain and split_part(lower(e.from_email), '@', 2) = a.address))
       group by c.id)
update public.accounting_contacts ct set person = '' from m where m.id = ct.id and m.person_n * 2 < m.n;
select set_config('t.c', :'c', false);
do $$ begin
  if (select person from public.accounting_contacts where id = current_setting('t.c')::uuid) <> '' then raise exception 'minority person name kept'; end if;
end $$;
rollback;
