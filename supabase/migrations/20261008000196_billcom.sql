-- 0196 — Bill.com, light (Dana, Oct 19). No auto-entry, no auto-payment, no vendor sync.
-- • vendors.billcom_send: the on/off switch on every vendor. Dana sets it, nothing else decides. A vendor invoice Claude
--   files from an email (orders@ or billing@) for a vendor with the switch on is forwarded once, with its attachments,
--   to Bill.com's inbox address, and the email is marked "Sent to Bill.com".
-- • billcom_connections: the developer key, organization id and the sync token (username = token name, password =
--   token value) the admin pastes in Settings. Kept out of reach of every signed-in user; only the billcom function reads them.
-- • billcom_bills: the bills Bill.com lists (read every 15 minutes; fields per its "Get list of bills" page), for pay-by
--   tasks 7 days ahead that close themselves when Bill.com shows them paid or scheduled, and for the dashboard card.
-- • billcom_forwards: what was forwarded, when, and what Bill.com has not turned into a bill yet ("sent, not yet entered").

alter table public.vendors add column if not exists billcom_send boolean not null default false;
comment on column public.vendors.billcom_send is 'Send this vendor''s invoices to Bill.com (Dana''s switch, Oct 19). Nothing else decides.';

create table if not exists public.billcom_connections (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  base_url        text not null default 'https://gateway.prod.bill.com/connect',
  dev_key         text,
  org_bill_id     text,
  username        text,
  password        text,
  inbox_address   text not null default 'shaverlakesports1@bill.com',
  session_id      text,
  session_at      timestamptz,
  connected_at    timestamptz,
  connected_by    uuid references public.profiles(id) on delete set null,
  last_sync_at    timestamptz,
  last_error      text,
  bills_seen      integer,
  sample          jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.billcom_connections enable row level security;
grant all on table public.billcom_connections to service_role;

create table if not exists public.billcom_bills (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bill_id         text not null,
  vendor_bill_id  text,
  vendor_name     text,
  invoice_number  text,
  invoice_date    date,
  due_date        date,
  amount          numeric(12,2),
  due_amount      numeric(12,2),
  payment_status  text,
  archived        boolean not null default false,
  raw             jsonb,
  first_seen_at   timestamptz not null default now(),
  synced_at       timestamptz not null default now(),
  gone_at         timestamptz,
  primary key (organization_id, bill_id)
);
create index if not exists billcom_bills_due on public.billcom_bills (organization_id, due_date) where gone_at is null;
alter table public.billcom_bills enable row level security;
drop policy if exists "billcom_bills: accounting read" on public.billcom_bills;
create policy "billcom_bills: accounting read" on public.billcom_bills for select to authenticated
  using (public.user_in_org(organization_id) and public.sees_accounting());
grant select on table public.billcom_bills to authenticated;
grant all on table public.billcom_bills to service_role;

create table if not exists public.billcom_forwards (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email_id        uuid not null unique references public.emails(id) on delete cascade,
  vendor_link_id  uuid references public.vendor_links(id) on delete set null,
  vendor_id       uuid references public.vendors(id) on delete set null,
  status          text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  sent_to         text,
  gmail_id        text,
  error           text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists billcom_forwards_org on public.billcom_forwards (organization_id, created_at desc);
alter table public.billcom_forwards enable row level security;
drop policy if exists "billcom_forwards: members read" on public.billcom_forwards;
create policy "billcom_forwards: members read" on public.billcom_forwards for select to authenticated using (public.user_in_org(organization_id));
grant select on table public.billcom_forwards to authenticated;
grant all on table public.billcom_forwards to service_role;

alter table public.emails add column if not exists billcom_sent_at timestamptz;
comment on column public.emails.billcom_sent_at is 'Forwarded to Bill.com''s inbox (the vendor''s switch is on).';

-- Bill.com's own addresses are a platform, never a vendor to ask about.
insert into public.email_senders (organization_id, sender_key, is_domain, kind, display_name, decided_at)
select o.id, 'bill.com', true, 'platform', 'Bill.com', now() from public.organizations o
on conflict (organization_id, sender_key) do nothing;

-- ---- An invoice lands for a vendor with the switch on: queue the forward and send it now ----------------------------
create or replace function public.billcom_forward_kick(p_forward uuid) returns void
language plpgsql security definer set search_path = public as $$
declare secret text;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;
  begin
    select decrypted_secret into secret from vault.decrypted_secrets where name = 'mail_cron_secret';
    if secret is null then return; end if;
    perform net.http_post(
      url := 'https://bpdpkytfmpbwpbmpejbf.supabase.co/functions/v1/billcom-forward',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
      body := jsonb_build_object('forward_id', p_forward),
      timeout_milliseconds := 120000);
  exception when others then null;
  end;
end;
$$;

create or replace function public.vendor_links_billcom() returns trigger
language plpgsql security definer set search_path = public as $$
declare fid uuid; e record;
begin
  if new.kind <> 'invoice' or new.source <> 'email' or new.email_id is null or new.vendor_id is null or new.storage_path is null then return new; end if;
  if not exists (select 1 from public.vendors v where v.id = new.vendor_id and v.billcom_send) then return new; end if;
  select direction, billcom_sent_at into e from public.emails where id = new.email_id;
  if e is null or e.direction = 'out' or e.billcom_sent_at is not null then return new; end if;
  insert into public.billcom_forwards (organization_id, email_id, vendor_link_id, vendor_id)
  values (new.organization_id, new.email_id, new.id, new.vendor_id)
  on conflict (email_id) do nothing
  returning id into fid;
  if fid is not null then perform public.billcom_forward_kick(fid); end if;
  return new;
end;
$$;
drop trigger if exists vendor_links_billcom on public.vendor_links;
create trigger vendor_links_billcom after insert or update of kind, vendor_id, storage_path on public.vendor_links
  for each row execute function public.vendor_links_billcom();

-- ---- Pay-by tasks from Bill.com's unpaid bills, 7 days ahead; closed when Bill.com shows them paid ------------------
create or replace function public.billcom_bill_tasks(p_org uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare b record; who uuid; n integer := 0; title text;
begin
  who := public.org_admin(p_org);
  if who is null then return 0; end if;
  for b in select * from public.billcom_bills where organization_id = p_org and gone_at is null and not archived
             and coalesce(upper(payment_status), '') not in ('PAID', 'SCHEDULED', 'IN_PROCESS') and coalesce(due_amount, amount, 0) > 0
             and due_date is not null and due_date <= current_date + 7 loop
    title := format('Pay %s $%s by %s (Bill.com)', coalesce(b.vendor_name, 'vendor'), to_char(coalesce(b.due_amount, b.amount), 'FM999,999,990.00'), to_char(b.due_date, 'FMMM/FMDD/YY'));
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, auto_key)
    values (p_org, title, concat_ws(' ', case when b.invoice_number is not null then 'Invoice ' || b.invoice_number || '.' end, 'Pay it in Bill.com; this task closes itself once Bill.com shows it paid.'),
            b.due_date, (b.due_date - 1)::timestamp + interval '9 hours', who, 'billcom:' || b.bill_id)
    on conflict (organization_id, auto_key) where auto_key is not null do update
      set title = excluded.title, due_date = excluded.due_date
      where public.tasks.done_at is null and (public.tasks.title <> excluded.title or public.tasks.due_date is distinct from excluded.due_date);
    n := n + 1;
  end loop;
  update public.tasks t set done_at = now(), done_note = 'Paid in Bill.com'
   where t.organization_id = p_org and t.auto_key like 'billcom:%' and t.done_at is null
     and not exists (select 1 from public.billcom_bills bb where bb.organization_id = p_org and bb.bill_id = split_part(t.auto_key, ':', 2)
                       and bb.gone_at is null and not bb.archived and coalesce(upper(bb.payment_status), '') not in ('PAID', 'SCHEDULED', 'IN_PROCESS') and coalesce(bb.due_amount, bb.amount, 0) > 0);
  return n;
end;
$$;
revoke execute on function public.billcom_bill_tasks(uuid) from public, anon, authenticated;
grant execute on function public.billcom_bill_tasks(uuid) to service_role;

-- "I paid it" on a Bill.com task: the task is done; the payment itself happens in Bill.com.
create or replace function public.task_mark_paid(p_task uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t   public.tasks%rowtype;
  v_id uuid;
begin
  select * into t from public.tasks where id = p_task;
  if t.id is null or not public.user_in_org(t.organization_id) then raise exception 'Task not found' using errcode = '23503'; end if;
  if not public.is_admin() then raise exception 'Only the admin marks bills paid' using errcode = '42501'; end if;
  if t.auto_key like 'wwd:%' then
    v_id := split_part(t.auto_key, ':', 2)::uuid;
    update public.wwd_invoices set sheet_paid_date = coalesce(sheet_paid_date, current_date),
           note = concat_ws(' · ', note, 'Marked paid in VMS ' || to_char(current_date, 'FMMM/FMDD/YY'))
     where id = v_id and organization_id = t.organization_id and paid_date is null and sheet_paid_date is null;
  elsif t.auto_key like 'order:%' then
    v_id := split_part(t.auto_key, ':', 2)::uuid;
    update public.orders set paid_date = coalesce(paid_date, current_date)
     where id = v_id and organization_id = t.organization_id;
  elsif t.auto_key like 'billcom:%' then
    null; -- paid in Bill.com itself; the next read confirms it
  else
    raise exception 'This task is not a bill to pay' using errcode = '22023';
  end if;
  update public.tasks set done_at = now(), done_by = auth.uid(), done_note = 'Paid' where id = p_task and done_at is null;
end;
$$;

-- ---- Sent to Bill.com but not a bill there yet (the dashboard card) ------------------------------------------------
create or replace function public.billcom_waiting(p_org uuid)
returns table (email_id uuid, thread_id uuid, vendor_name text, file_name text, doc_number text, doc_total numeric, sent_at timestamptz)
language sql stable security definer set search_path = public as $$
  select f.email_id, e.thread_id, v.name, l.file_name, l.doc_number, l.doc_total, f.sent_at
  from public.billcom_forwards f
  join public.emails e on e.id = f.email_id
  left join public.vendor_links l on l.id = f.vendor_link_id
  left join public.vendors v on v.id = f.vendor_id
  where f.organization_id = p_org and public.user_in_org(p_org) and public.sees_accounting()
    and f.status = 'sent' and f.sent_at >= now() - interval '90 days'
    and not exists (
      select 1 from public.billcom_bills b
      where b.organization_id = p_org and b.gone_at is null and b.first_seen_at >= f.sent_at - interval '1 day'
        and ((l.doc_number is not null and length(regexp_replace(l.doc_number, '[^A-Za-z0-9]', '', 'g')) >= 3
              and upper(regexp_replace(b.invoice_number, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(l.doc_number, '[^A-Za-z0-9]', '', 'g')))
             or (l.doc_total is not null and b.amount = l.doc_total and v.name is not null and b.vendor_name is not null
                 and upper(left(regexp_replace(b.vendor_name, '[^A-Za-z0-9]', '', 'g'), 6)) = upper(left(regexp_replace(v.name, '[^A-Za-z0-9]', '', 'g'), 6)))))
  order by f.sent_at desc
$$;
revoke execute on function public.billcom_waiting(uuid) from public, anon;
grant execute on function public.billcom_waiting(uuid) to authenticated, service_role;

-- ---- Read Bill.com every 15 minutes -------------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'billcom-sync';
    perform cron.schedule('billcom-sync', '*/15 * * * *',
      $job$select net.http_post(url := 'https://bpdpkytfmpbwpbmpejbf.supabase.co/functions/v1/billcom', headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mail_cron_secret')), body := '{"action":"sync"}'::jsonb, timeout_milliseconds := 120000)$job$);
  end if;
end $$;
