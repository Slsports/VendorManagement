-- 0314 — Fix to 0309: the Bill.com watch looked at every EJD email, so EJD's order confirmation for the Paricon sleds
-- (EJDPARICON11526, Nov 5, sent by EJD's system straight to orders@) looked like "EJD now bills billing@ directly" and turned
-- Send invoices to Bill.com on for EMERY JENSEN DIST and STIHL INC. Nothing was sent to Bill.com (no forwards since).
-- Now only an email that reaches the billing@ mailbox counts. EJD and Stihl go back to off with the watch on, and the task
-- it made is closed with a note.
set local lock_timeout = '5s';

create or replace function public.email_billcom_auto_on() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v      public.vendors%rowtype;
  names  text;
  admin  uuid;
begin
  if new.direction <> 'in' or new.vendor_id is null or coalesce(cardinality(new.delivered_to), 0) = 0 then return null; end if;
  -- only mail that reached the billing@ mailbox says where their invoices go (order confirmations to orders@ never count)
  if new.mailbox_id is null or not exists (select 1 from public.mailboxes b where b.id = new.mailbox_id and b.kind = 'accounting') then return null; end if;
  select * into v from public.vendors where id = new.vendor_id;
  if v.id is null or v.billcom_auto_on_from is null then return null; end if;
  if lower(v.billcom_auto_on_from) = any (new.delivered_to || coalesce(new.to_emails, '{}') || coalesce(new.cc_emails, '{}')) then return null; end if;
  with u as (
    update public.vendors x set billcom_send = true, billcom_send_on_at = now(), billcom_auto_on_from = null, updated_at = now()
     where x.organization_id = v.organization_id and x.merged_into_id is null
       and (x.id = v.id or (x.billcom_auto_on_from is not null and x.parent_company is not null and upper(x.parent_company) = upper(v.name)))
    returning x.name)
  select string_agg(name, ' and ' order by name) into names from u;
  admin := public.org_admin(v.organization_id);
  if admin is not null then
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, thread_id, area, auto_key)
    values (v.organization_id, left(format('%s now emails %s directly: turn off the %s forward', v.name, coalesce(new.gmail_box, 'our mailbox'), v.billcom_auto_on_from), 200),
            format('Their %s email of %s came straight to %s, not through %s. VMS turned on Send invoices to Bill.com for %s, so their invoices now go to Bill.com from VMS. Turn off the forward for them in %s so Bill.com does not get each one twice.',
                   v.name, to_char(new.received_at at time zone 'America/Los_Angeles', 'Mon DD, YYYY'), coalesce(new.gmail_box, 'our mailbox'), v.billcom_auto_on_from,
                   coalesce(names, v.name), v.billcom_auto_on_from),
            (now() at time zone 'America/Los_Angeles')::date, now(), admin, v.id, new.thread_id, 'accounting', 'billcom_auto:' || v.id)
    on conflict (organization_id, auto_key) where auto_key is not null do nothing;
  end if;
  return null;
end;
$$;
revoke execute on function public.email_billcom_auto_on() from public, anon, authenticated;

-- undo the Nov 5 mistake: EJD and Stihl back to off, watching again; the task closed by VMS with what happened
do $$
declare v_ejd uuid;
begin
  select id into v_ejd from public.vendors where name = 'EMERY JENSEN DIST' and merged_into_id is null;
  if v_ejd is null then return; end if;
  update public.vendors set billcom_send = false, billcom_send_on_at = null, billcom_auto_on_from = 'billing.slsports@gmail.com', updated_at = now()
   where merged_into_id is null and name in ('EMERY JENSEN DIST', 'STIHL INC')
     and billcom_send and billcom_send_on_at >= timestamptz '2026-11-05 22:00:00+00' and billcom_send_on_at < timestamptz '2026-11-05 22:30:00+00'
     and not exists (select 1 from public.billcom_forwards f where f.vendor_id = vendors.id and f.created_at >= timestamptz '2026-11-05 22:00:00+00');
  update public.tasks set done_at = now(), closed_how = 'vms',
         done_note = 'Closed by VMS: this was a mistake. EJD''s order confirmation for the Paricon sleds came to orders@, not to billing@, so it did not mean EJD bills billing@ directly. Send invoices to Bill.com is back off for EMERY JENSEN DIST and STIHL INC; keep the billing.slsports@gmail.com forward on. Nothing was sent to Bill.com.'
   where auto_key = 'billcom_auto:' || v_ejd and done_at is null;
end $$;
