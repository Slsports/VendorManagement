-- A changed order's unapproved freight quotes from before the change are deleted and their tasks closed as mistakes;
-- an approved quote and a quote from after the change stay.
begin;
select '00000000-0000-0000-0000-000000000001'::uuid as org, '11111111-1111-1111-1111-111111111111'::uuid as me \gset
insert into public.vendors (organization_id, name) values (:'org', 'Quote Test 0346') returning id as v \gset
insert into public.orders (organization_id, vendor_id, po_number, status) values (:'org', :'v', 'Q0346', 'open') returning id as o \gset
insert into public.email_threads (organization_id, gmail_thread_id) values (:'org', 'th-0346') returning id as th \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, received_at) values (:'org', 'q0346-1', :'th', 'in', now() - interval '3 hours') returning id as e_old \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, received_at) values (:'org', 'q0346-2', :'th', 'in', now() - interval '4 hours') returning id as e_ok \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, received_at) values (:'org', 'q0346-3', :'th', 'out', now() - interval '1 hour') returning id as e_rev \gset
insert into public.emails (organization_id, gmail_id, thread_id, direction, received_at) values (:'org', 'q0346-4', :'th', 'in', now()) returning id as e_new \gset
insert into public.freight_quotes (organization_id, vendor_id, order_id, email_id, thread_id, status, vendor_cost) values
  (:'org', :'v', :'o', :'e_old', :'th', 'waiting', 2274) returning id as q_old \gset
insert into public.freight_quotes (organization_id, vendor_id, order_id, email_id, thread_id, status, vendor_cost) values
  (:'org', :'v', :'o', :'e_ok', :'th', 'approved', 500) returning id as q_ok \gset
insert into public.freight_quotes (organization_id, vendor_id, order_id, email_id, thread_id, status, vendor_cost) values
  (:'org', :'v', :'o', :'e_new', :'th', 'waiting', 900) returning id as q_new \gset
insert into public.tasks (organization_id, title, assigned_to, auto_key) values (:'org', 'Get freight quote 0346', :'me', 'freight_quote:' || :'q_old');
select public.order_revised_drop_quotes(:'o', :'e_rev') as n \gset
select set_config('t.n', :'n', false), set_config('t.old', :'q_old', false), set_config('t.ok', :'q_ok', false), set_config('t.new', :'q_new', false);
do $$ begin
  if current_setting('t.n')::int <> 1 then raise exception 'expected 1 dropped, got %', current_setting('t.n'); end if;
  if exists (select 1 from public.freight_quotes where id = current_setting('t.old')::uuid) then raise exception 'old quote kept'; end if;
  if not exists (select 1 from public.freight_quotes where id = current_setting('t.ok')::uuid) then raise exception 'approved quote dropped'; end if;
  if not exists (select 1 from public.freight_quotes where id = current_setting('t.new')::uuid) then raise exception 'newer quote dropped'; end if;
  if (select closed_how from public.tasks where auto_key = 'freight_quote:' || current_setting('t.old')) is distinct from 'mistake' then raise exception 'task not closed as mistake'; end if;
end $$;
rollback;
