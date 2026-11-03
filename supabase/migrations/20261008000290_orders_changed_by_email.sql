-- 0290 — Orders follow the newest email (Dana, Nov 3: "Newer email should win throughout VMS"; "go 1-4 & 6").
--   * A vendor (or their rep) writes that the store's order is cancelled, or an ordering service (NuORDER, Faire…) sends
--     the cancellation: the order is marked Cancelled with a note naming the email, and whoever placed it gets an FYI task
--     that opens the email. An order already received, entered or paid is never changed; that email is left for a person.
--   * Changed orders (a service's changed order, our own revised or re-sent order) replace the item lines in the
--     sent-orders function; this file only holds the cancel step both paths use.
set local lock_timeout = '5s';

create or replace function public.order_cancel_from_mail(p_order uuid, p_email uuid, p_who text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  o   public.orders%rowtype;
  e   public.emails%rowtype;
  t   public.email_threads%rowtype;
  who uuid;
  note text;
begin
  select * into o from public.orders where id = p_order for update;
  if o.id is null or o.status in ('received', 'entered', 'ready_to_pay', 'paid', 'cancelled') then return false; end if;
  select * into e from public.emails where id = p_email;
  if e.id is null then return false; end if;
  select * into t from public.email_threads where id = e.thread_id;
  note := format('Cancelled per %s email of %s (newer email wins).', coalesce(nullif(trim(p_who), ''), 'the'),
                 to_char(e.received_at at time zone 'America/Los_Angeles', 'Mon DD, YYYY'));
  update public.orders set status = 'cancelled', notes = concat_ws(' ', nullif(notes, ''), note) where id = o.id;
  who := coalesce(o.placed_by_id, t.owner_id, public.org_admin(o.organization_id));
  -- our own cancel email needs no FYI to ourselves
  if who is not null and coalesce(p_who, '') <> 'our' then
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, order_id, thread_id, auto_key)
    values (o.organization_id,
            left(format('FYI: order %s was cancelled', coalesce(nullif(o.po_number, ''), nullif(o.description, ''), '')), 200),
            note || ' Click to open the email. Reopen the order if this is wrong.',
            (now() at time zone 'America/Los_Angeles')::date, now(), who, o.vendor_id, o.id, e.thread_id, 'ordercancel:' || o.id)
    on conflict (organization_id, auto_key) where auto_key is not null do nothing;
  end if;
  return true;
end;
$$;
revoke execute on function public.order_cancel_from_mail(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.order_cancel_from_mail(uuid, uuid, text) to service_role;

-- the reply check read a vendor's email as "this order is cancelled": only the vendor's own shared mail about one order
create or replace function public.order_cancel_from_email(p_email uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  e   public.emails%rowtype;
  t   public.email_threads%rowtype;
  vn  text;
begin
  select * into e from public.emails where id = p_email;
  if e.id is null or e.direction <> 'in' or e.order_id is null or e.vendor_id is null then return false; end if;
  select * into t from public.email_threads where id = e.thread_id;
  if e.mailbox_id is not null and t.shared_at is null then return false; end if;
  if exists (select 1 from public.email_senders s where s.id = e.sender_id and s.kind = 'carrier') then return false; end if;
  select name into vn from public.vendors where id = e.vendor_id;
  return public.order_cancel_from_mail(e.order_id, e.id, coalesce(vn || '''s', 'the vendor''s'));
end;
$$;
revoke execute on function public.order_cancel_from_email(uuid) from public, anon, authenticated;
grant execute on function public.order_cancel_from_email(uuid) to service_role;
