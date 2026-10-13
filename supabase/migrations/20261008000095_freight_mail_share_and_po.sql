-- 0116 — Freight mail is part of ordering (Dana, Oct 13): "we still need the freight companies included. It is all part of
-- the ordering process so those freight emails should tag to both the freight co and the vendor." Mail from a freight
-- company (Priority One, WWEX, XPO, UPS…) in Trevor's or Jarrett's mailbox or the Old Gmail is shared to Orders like vendor
-- mail (never Dana's own mailbox), and any email that names one of our PO numbers is tagged to that order's vendor and
-- tied to the order: "Sometimes the vendors screw up and dont use our po" is handled by the freight-quote matcher.

-- Known vendors, rep groups and now freight companies share their conversations.
create or replace function public.share_vendor_threads(p_org uuid, p_email uuid default null, p_sender uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with hit as (
    select distinct e.thread_id
      from public.emails e
      join public.email_senders s on s.id = e.sender_id and s.kind in ('vendor', 'rep_group', 'carrier')
      join public.mailboxes m on m.id = e.mailbox_id and m.auto_share_vendor_mail
     where e.organization_id = p_org and e.direction = 'in' and e.mailbox_id is not null and e.thread_id is not null
       and (p_email is null or e.id = p_email)
       and (p_sender is null or e.sender_id = p_sender)
       and (p_email is not null or e.received_at > now() - interval '365 days')
  )
  update public.email_threads t set shared_at = now()
    from hit
   where t.id = hit.thread_id and t.mailbox_id is not null and t.shared_at is null and not t.auto_share_off;
  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.email_senders_share_vendor_mail() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind in ('vendor', 'rep_group', 'carrier') and old.kind is distinct from new.kind then
    perform public.share_vendor_threads(new.organization_id, null, new.id);
  end if;
  return new;
end;
$$;

-- Our PO numbers named in an email (subject or text): normalized, five characters or more, open in the last 13 months.
create or replace function public.email_po_orders(p_email uuid)
returns table (order_id uuid, vendor_id uuid)
language sql stable security definer set search_path = public as $$
  with e as (
    select organization_id, upper(regexp_replace(coalesce(subject, '') || ' ' || left(coalesce(body_text, snippet, ''), 20000), '[^A-Za-z0-9]+', ' ', 'g')) as words
      from public.emails where id = p_email
  )
  select o.id, o.vendor_id
    from e join public.orders o on o.organization_id = e.organization_id
   where o.status <> 'cancelled' and o.po_number is not null
     and length(regexp_replace(o.po_number, '[^A-Za-z0-9]', '', 'g')) >= 5
     and coalesce(o.order_date, o.created_at::date) > current_date - 400
     and (' ' || e.words || ' ') like '% ' || upper(regexp_replace(o.po_number, '[^A-Za-z0-9]+', ' ', 'g')) || ' %'
$$;
revoke execute on function public.email_po_orders(uuid) from public, anon, authenticated;
grant execute on function public.email_po_orders(uuid) to service_role;

-- Tag the email to the vendors whose PO it names; one order named → the email belongs to that order.
create or replace function public.email_tag_by_po(p_email uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  e  public.emails%rowtype;
  n  integer := 0;
  ids uuid[];
begin
  select * into e from public.emails where id = p_email;
  if e.id is null then return 0; end if;
  select array_agg(distinct order_id) into ids from public.email_po_orders(p_email);
  if ids is null then return 0; end if;
  insert into public.email_vendor_tags (email_id, vendor_id, organization_id, how)
  select distinct p_email, x.vendor_id, e.organization_id, 'auto' from public.email_po_orders(p_email) x
   where x.vendor_id is distinct from e.vendor_id
  on conflict do nothing;
  get diagnostics n = row_count;
  if array_length(ids, 1) = 1 and e.order_id is null then
    update public.emails set order_id = ids[1] where id = p_email;
  end if;
  return n;
end;
$$;
revoke execute on function public.email_tag_by_po(uuid) from public, anon, authenticated;
grant execute on function public.email_tag_by_po(uuid) to service_role;

-- Freight-company mail and anything about a freight quote is checked for our PO numbers as it arrives.
create or replace function public.emails_tag_by_po() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.direction = 'in' and (
       coalesce(new.subject, '') ~* '(freight|quote|pickup|pick up|bill of lading|\mbol\M|\mpro\M|routing|tracking|shipment|shipped)'
       or exists (select 1 from public.email_senders s where s.id = new.sender_id and s.kind in ('carrier', 'platform'))) then
    perform public.email_tag_by_po(new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists emails_tag_by_po on public.emails;
create trigger emails_tag_by_po after insert on public.emails for each row execute function public.emails_tag_by_po();

-- The last 12 months: share freight conversations, then tag freight mail by PO (last 90 days).
select public.share_vendor_threads(o.id) from public.organizations o where exists (select 1 from public.mailboxes m where m.organization_id = o.id);
select count(public.email_tag_by_po(e.id))
  from public.emails e left join public.email_senders s on s.id = e.sender_id
 where e.direction = 'in' and e.copy_of is null and e.received_at > now() - interval '90 days'
   and (coalesce(e.subject, '') ~* '(freight|quote|pickup|pick up|bill of lading|\mbol\M|\mpro\M|routing|tracking|shipment|shipped)' or s.kind in ('carrier', 'platform'));
