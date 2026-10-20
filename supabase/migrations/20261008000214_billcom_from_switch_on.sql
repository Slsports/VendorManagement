-- 0214 — Bill.com forwards only what came in after the switch went on (Dana, Oct 20: switch on for Rod's Power Bait,
-- Salter's, Mountain Milk, Scope, Hendrix, Kelli's, Dick's Mountain Tackle and Brad's). Those vendors already have 83
-- emailed invoices on file, paid long ago; re-filing one later must never send it to Bill.com again. So a vendor's
-- invoice is forwarded only when its email arrived on or after the day the switch was turned on.

alter table public.vendors add column if not exists billcom_send_on_at timestamptz;
comment on column public.vendors.billcom_send_on_at is 'When the Bill.com switch was turned on; only invoices emailed on or after it are forwarded.';
update public.vendors set billcom_send_on_at = now() where billcom_send and billcom_send_on_at is null;

create or replace function public.vendors_billcom_on() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.billcom_send and (tg_op = 'INSERT' or not old.billcom_send) then new.billcom_send_on_at := now(); end if;
  return new;
end;
$$;
drop trigger if exists vendors_billcom_on on public.vendors;
create trigger vendors_billcom_on before insert or update of billcom_send on public.vendors
  for each row execute function public.vendors_billcom_on();

create or replace function public.vendor_links_billcom() returns trigger
language plpgsql security definer set search_path = public as $$
declare fid uuid; e record; v_on timestamptz;
begin
  if new.kind <> 'invoice' or new.source <> 'email' or new.email_id is null or new.vendor_id is null or new.storage_path is null then return new; end if;
  select billcom_send_on_at into v_on from public.vendors v where v.id = new.vendor_id and v.billcom_send;
  if v_on is null then return new; end if;
  select direction, billcom_sent_at, received_at into e from public.emails where id = new.email_id;
  if e is null or e.direction = 'out' or e.billcom_sent_at is not null then return new; end if;
  -- older than the switch: already handled by hand before VMS sent anything
  if e.received_at < date_trunc('day', v_on at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles' then return new; end if;
  insert into public.billcom_forwards (organization_id, email_id, vendor_link_id, vendor_id)
  values (new.organization_id, new.email_id, new.id, new.vendor_id)
  on conflict (email_id) do nothing
  returning id into fid;
  if fid is not null then perform public.billcom_forward_kick(fid); end if;
  return new;
end;
$$;
