-- 0309 — Bill.com forwarding turns itself on when a vendor starts billing billing@ directly (Dana, Nov 4: EJD and Stihl invoices
--   must reach Bill.com; for now her billing.slsports@gmail.com filter forwards them, "I am going to try to get ejd switched to
--   my billing@ email" — "Go" on VMS switching EJD and Stihl on by itself and telling her to turn the Gmail forward off).
--   * emails.delivered_to: the addresses a message was delivered or forwarded to (Delivered-To, X-Forwarded-To / -For,
--     X-Original-To), saved by the mail sync from now on.
--   * vendors.billcom_auto_on_from: the old address the vendor's invoices come through. The first email from that vendor that
--     reaches one of our mailboxes without passing through it turns "Send invoices to Bill.com" on for the vendor and for any
--     vendor it bills (parent / billing company), and gives the admin a task to turn the old forward off. Then it clears.
set local lock_timeout = '5s';

alter table public.emails add column if not exists delivered_to text[];
comment on column public.emails.delivered_to is 'Delivered-To / X-Forwarded-To / -For / X-Original-To addresses, lowercased (0309).';
alter table public.vendors add column if not exists billcom_auto_on_from text;
comment on column public.vendors.billcom_auto_on_from is 'Turn Send invoices to Bill.com on when this vendor''s mail first arrives without passing through this address (0309).';

create or replace function public.email_billcom_auto_on() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v      public.vendors%rowtype;
  names  text;
  admin  uuid;
begin
  if new.direction <> 'in' or new.vendor_id is null or coalesce(cardinality(new.delivered_to), 0) = 0 then return null; end if;
  select * into v from public.vendors where id = new.vendor_id;
  if v.id is null or v.billcom_auto_on_from is null then return null; end if;
  -- still coming through the old address: nothing changes
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
drop trigger if exists emails_billcom_auto_on on public.emails;
create trigger emails_billcom_auto_on after insert or update of vendor_id on public.emails
  for each row execute function public.email_billcom_auto_on();

-- Stihl is billed by EJD. The watch on EJD and Stihl (billcom_auto_on_from = billing.slsports@gmail.com) is set once the first
-- EJD emails saved with delivered_to show the Gmail forward's address, so a forwarded one can never look direct.
update public.vendors set parent_company = 'EMERY JENSEN DIST'
 where name = 'STIHL INC' and merged_into_id is null and parent_company is null;
