-- 0305 — A pickup or in-transit email moves the order to Shipped (Dana, Nov 3: Becker BECKER2926 "was picked up today and is
--   in transit with XPO" but VMS still said Confirmed; Nov 4: "yes").
--   The reply check already tags each shipping email picked up / in transit / out for delivery / delivered; now it also reads
--   the carrier, the BOL / PRO / tracking number and the expected date (emails.ship_carrier, ship_ref, ship_eta). When such an
--   email is about one of our orders (Orders or shared mail) and the order is Open, Waiting for confirmation or Confirmed, the
--   order moves to Shipped with a note (who wrote, carrier, number, expected date) and the email on the order
--   (orders.shipped_email_id: "Shipped per email" opens it). Orders already received, entered or paid never change.
--   Back-check: the last 90 days of shipping emails.
set local lock_timeout = '5s';

alter table public.emails add column if not exists ship_carrier text;
alter table public.emails add column if not exists ship_ref text;
alter table public.emails add column if not exists ship_eta date;
-- no foreign key on purpose: orders already has two keys to emails, a third would make embeds ambiguous
alter table public.orders add column if not exists shipped_email_id uuid;
comment on column public.orders.shipped_email_id is 'The carrier or vendor email that moved the order to Shipped (0305).';

create or replace function public.order_shipped_from_email(p_email uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  e     public.emails%rowtype;
  o     public.orders%rowtype;
  word  text;
  who   text;
  carr  text;
  n     integer;
begin
  select * into e from public.emails where id = p_email;
  if e.id is null or e.order_id is null or e.mailbox_id is not null or e.copy_of is not null
     or coalesce(e.ship_status, '') not in ('picked_up', 'in_transit', 'out_for_delivery', 'delivered') then return false; end if;
  select * into o from public.orders where id = e.order_id;
  if o.id is null or o.status not in ('open', 'awaiting_confirmation', 'confirmed') then return false; end if;
  word := case e.ship_status when 'picked_up' then 'picked up' when 'in_transit' then 'in transit' when 'out_for_delivery' then 'out for delivery' else 'delivered by the carrier' end;
  who := coalesce(nullif(trim(e.from_name), ''), e.from_email, 'the carrier');
  carr := coalesce(nullif(trim(e.ship_carrier), ''), (select c.name from public.email_senders s join public.carriers c on c.id = s.carrier_id where s.id = e.sender_id));
  update public.orders set status = 'shipped', shipped_email_id = e.id, updated_at = now(),
         shipment_notes = concat_ws(' ', nullif(shipment_notes, ''),
           format('Shipped: %s%s%s%s (%s, %s; VMS moved it to Shipped).', word,
                  coalesce(' by ' || carr, ''),
                  coalesce(', BOL/tracking ' || nullif(trim(e.ship_ref), ''), ''),
                  coalesce(', expected ' || to_char(e.ship_eta, 'Mon DD, YYYY'), ''),
                  who, to_char(e.received_at at time zone 'America/Los_Angeles', 'Mon DD, YYYY')))
   where id = o.id and status in ('open', 'awaiting_confirmation', 'confirmed');
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
revoke execute on function public.order_shipped_from_email(uuid) from public, anon, authenticated;
grant execute on function public.order_shipped_from_email(uuid) to service_role;

create or replace function public.email_ship_moves_order() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.ship_status in ('picked_up', 'in_transit', 'out_for_delivery', 'delivered') and new.order_id is not null
     and (tg_op = 'INSERT' or new.ship_status is distinct from old.ship_status or new.order_id is distinct from old.order_id) then
    perform public.order_shipped_from_email(new.id);
  end if;
  return null;
end;
$$;
revoke execute on function public.email_ship_moves_order() from public, anon, authenticated;
drop trigger if exists emails_ship_moves_order on public.emails;
create trigger emails_ship_moves_order after insert or update of ship_status, order_id on public.emails
  for each row execute function public.email_ship_moves_order();

-- back-check: shipping emails of the last 90 days, oldest first (the newest one's note comes last)
do $$
declare r record; n integer := 0;
begin
  for r in select id from public.emails
            where ship_status in ('picked_up', 'in_transit', 'out_for_delivery', 'delivered') and order_id is not null
              and mailbox_id is null and copy_of is null and received_at > now() - interval '90 days'
            order by received_at loop
    if public.order_shipped_from_email(r.id) then n := n + 1; end if;
  end loop;
  raise notice 'orders moved to Shipped: %', n;
end $$;
