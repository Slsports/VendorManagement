-- 0271 — Freight quote reading, two fixes from the first run over Dana's inbox (Oct 31):
--   • A conversation that already has an approved price opens no new quote: the routing company's follow-up "please
--     proceed with shipping via FedEx Ground at $375.87" (World Famous, PO WFS24236) had opened a "which order?" task for
--     Dana after she had said "Yes, please!".
--   • Our own note to one of us is not a quote: Dana's forward to Trevor ("Can you please get a quote from ups on this")
--     had been read as one. A forward to orders@ still counts.
-- The two extra quotes are set aside and the task closed.

set local lock_timeout = '5s';

drop function if exists public.freight_quote_queue(uuid, integer);
create function public.freight_quote_queue(p_org uuid, p_limit integer default 10)
returns table (email_id uuid, thread_id uuid, vendor_id uuid, sender_kind text, from_name text, from_email text, subject text, body_text text,
               received_at timestamptz, attachments text[], direction text, private boolean)
language sql stable security definer set search_path = public as $$
  select e.id, e.thread_id, coalesce(e.vendor_id, s.vendor_id), s.kind, e.from_name, e.from_email, e.subject, left(coalesce(e.body_text, e.snippet, ''), 6000), e.received_at,
         coalesce((select array_agg(a.file_name) from public.email_attachments a where a.email_id = e.id), '{}'),
         e.direction, e.mailbox_id is not null and t.shared_at is null
    from public.emails e
    left join public.email_senders s on s.id = e.sender_id
    left join public.email_threads t on t.id = e.thread_id
   where e.organization_id = p_org and e.copy_of is null and e.freight_scan_at is null
     and e.received_at >= timestamptz '2026-10-14 00:00 America/Los_Angeles'
     and (e.mailbox_id is null or t.shared_at is not null
          or exists (select 1 from public.mailboxes b where b.id = e.mailbox_id and b.kind = 'personal' and b.owner_id = public.org_admin(p_org)))
     and ((e.direction = 'in' and coalesce(s.kind, 'unknown') in ('vendor', 'rep_group', 'carrier', 'platform', 'unknown')
           -- our own note to one of us (Dana's "can you get a quote from UPS" forward to Trevor) is not a quote; our
           -- forward to orders@ still counts
           and not (public.is_our_address(p_org, e.from_email)
                    and not exists (select 1 from public.mail_accounts ma where ma.organization_id = p_org
                                     and lower(ma.mailbox) = any (select lower(x) from unnest(e.to_emails || e.cc_emails) x))))
          or (e.direction = 'out' and public.is_our_address(p_org, e.from_email)))
     and (coalesce(e.subject, '') || ' ' || left(coalesce(e.body_text, e.snippet, ''), 3000))
         ~* '(freight|quote|ready to ship|ready for pick|pick ?up|cartons|pallets?|dimensions|\mdims\M|ship(ping)? (cost|charge)|routing|bill of lading|\mltl\M|\mxpo\M)'
   order by e.received_at
   limit p_limit
$$;
revoke execute on function public.freight_quote_queue(uuid, integer) from public, anon, authenticated;
grant execute on function public.freight_quote_queue(uuid, integer) to service_role;

create or replace function public.freight_quote_apply(p_email uuid, p_is_quote boolean, p_reading jsonb, p_vendor uuid, p_order uuid, p_how text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  e      public.emails%rowtype;
  v_id   uuid;
  v_task uuid;
  v_name text;
  v_po   text;
  v_who  uuid;
  v_due  date;
  v_by   text;
  v_priv boolean;
begin
  select * into e from public.emails where id = p_email;
  if e.id is null then return null; end if;
  update public.emails set freight_scan_at = now() where id = p_email;
  if not p_is_quote then return null; end if;
  -- the order (or the conversation) already has its approved price: a later email (Becker: "Yes it is ready … Will you
  -- be sending a BOL?"; the routing company's "please proceed … at $375.87") opens no new quote or task
  if exists (select 1 from public.freight_quotes x where x.status = 'approved'
              and ((p_order is not null and x.order_id = p_order) or (e.thread_id is not null and x.thread_id = e.thread_id))) then return null; end if;
  v_priv := e.mailbox_id is not null and not exists (select 1 from public.email_threads t where t.id = e.thread_id and t.shared_at is not null);
  if p_order is not null then
    select coalesce(p_vendor, vendor_id), po_number into p_vendor, v_po from public.orders where id = p_order;
  end if;
  select name into v_name from public.vendors where id = p_vendor;
  v_by := public.freight_ships_by(p_reading);
  insert into public.freight_quotes (organization_id, vendor_id, order_id, email_id, thread_id, status, match_how,
                                     vendor_carrier, vendor_service, vendor_cost, transit, details, ships_by)
  values (e.organization_id, p_vendor, p_order, e.id, e.thread_id, case when p_order is null then 'needs_order' else 'waiting' end,
          case when p_order is null then null else p_how end,
          nullif(p_reading->>'carrier', ''), nullif(p_reading->>'service', ''),
          case when coalesce(p_reading->>'cost', '') ~ '^[0-9]+(\.[0-9]+)?$' then (p_reading->>'cost')::numeric end,
          nullif(p_reading->>'transit', ''), case when v_priv then '{}'::jsonb else coalesce(p_reading->'details', '{}'::jsonb) end, v_by)
  on conflict (email_id) do nothing
  returning id into v_id;
  if v_id is null then return null; end if;
  if p_order is not null then update public.emails set order_id = coalesce(order_id, p_order) where id = p_email; end if;

  v_who := case when v_priv then (select owner_id from public.mailboxes where id = e.mailbox_id) else public.freight_assignee(e.organization_id) end;
  v_due := public.next_business_day(e.received_at);
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, order_id, thread_id, auto_key)
  values (e.organization_id,
          public.freight_task_title(v_name, v_po, p_order is null, v_by),
          case v_by when 'pallet' then 'Pallet: get a Priority One price, then approve the cheaper one on the freight quote (Freight › Freight quotes).'
                    when 'parcel' then 'Parcel: get a UPS price through WWEX, then approve the cheaper one on the freight quote (Freight › Freight quotes).'
                    else 'Pallet → Priority One; parcel (boxes) → UPS through WWEX. Get that price, then approve the cheaper one (Freight › Freight quotes).' end,
          v_due, (v_due + time '09:00') at time zone 'America/Los_Angeles', v_who, p_vendor, p_order, e.thread_id, 'freight_quote:' || v_id)
  on conflict (organization_id, auto_key) where auto_key is not null do nothing
  returning id into v_task;
  update public.freight_quotes set task_id = v_task where id = v_id;
  return v_id;
end;
$function$;

update public.tasks t set done_at = now(), done_note = 'Not needed: Dana had already approved FedEx Ground at $375.87 in this conversation.'
  from public.freight_quotes q where q.id::text like '2b9edf7c%' and t.id = q.task_id and t.done_at is null;
update public.freight_quotes set status = 'declined', approved_choice = null, approved_cost = null, our_note = 'Not a quote: a follow-up after the price was approved.'
 where id::text like '2b9edf7c%';
update public.tasks t set done_at = now(), done_note = 'Not needed: our own note asking Trevor for a UPS price, not a quote.'
  from public.freight_quotes q where q.id::text like '6ce3107e%' and t.id = q.task_id and t.done_at is null;
update public.freight_quotes set status = 'declined', approved_choice = null, approved_cost = null, our_note = 'Not a quote: our own note to Trevor.'
 where id::text like '6ce3107e%';
