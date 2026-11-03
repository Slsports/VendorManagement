-- 0289 — The newer paper wins on an order (Dana, Nov 3: "Newer email should win throughout VMS"; "go 1-4 & 6").
--   1. A revised confirmation (same confirmation number on the same order, read again with a new date or total) replaces
--      the earlier one: the earlier paper moves to Confirmations › Old, its check is closed with a note naming the newer
--      one, and its item cards close. Different confirmation numbers on one order (split shipments like SO 88198-2, -3)
--      are left alone.
--   2. Backorders follow the newest paper: the order's newest confirmation or invoice decides the Backorder flag. Items
--      an older paper had on backorder that the newest one doesn't list are marked replaced, and when nothing is left on
--      backorder the vendor's "backorders or shipping delays" tasks close (VMS, with a note).
--   3. Those delay tasks also close when the order moves to Shipped or later with nothing on backorder, or when a newer
--      email in that conversation shows it shipped.
-- Back-check: every order with papers is run once; counts are reported to Dana.
set local lock_timeout = '5s';

alter table public.item_changes add column if not exists superseded_at timestamptz;
alter table public.item_changes add column if not exists superseded_note text;
comment on column public.item_changes.superseded_at is 'A newer paper from the vendor replaced this reading (newer email wins, Nov 3).';

create or replace function public.paper_key(p text) returns text language sql immutable set search_path = '' as $$
  -- "12345", "12345-R1", "12345 Rev 2", "12345 REVISED" are one confirmation; "SR12345" keeps its R
  select nullif(regexp_replace(regexp_replace(upper(coalesce(p, '')), '([-_ ]+R\d*|[-_ ]*REV(ISED|ISION)?[-_ .]*\d*)$', ''), '[^A-Z0-9]', '', 'g'), '')
$$;

-- the vendor's delay tasks for an order close once nothing is on backorder and it is on its way (or the paper says so)
create or replace function public.order_delay_tasks_close(p_order uuid, p_note text) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update public.tasks set done_at = now(), done_note = left(p_note, 500)
   where order_id = p_order and auto_key like 'shipupd:%' and done_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.order_delay_tasks_close(uuid, text) from public, anon, authenticated;

create or replace function public.order_check_newer_wins(p_check uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  c        public.order_checks%rowtype;
  x        public.order_checks%rowtype;
  latest   public.order_checks%rowtype;
  older    public.order_checks%rowtype;
  newer    public.order_checks%rowtype;
  vname    text;
  was_bo   boolean;
  now_bo   boolean;
  replaced integer := 0;
  cleared  integer := 0;
  closed   integer := 0;
  label    text;
begin
  select * into c from public.order_checks where id = p_check;
  if c.id is null or c.order_id is null or c.status not in ('comparing', 'to_review', 'done') then return 'skip'; end if;
  select name into vname from public.vendors where id = c.vendor_id;

  -- 1. a revised confirmation: same number on the same order → the newer one stays
  if c.kind = 'confirmation' and public.paper_key(c.doc_number) is not null then
    for x in select * from public.order_checks
              where order_id = c.order_id and kind = 'confirmation' and id <> c.id and status in ('comparing', 'to_review', 'done', 'needs_order')
                and public.paper_key(doc_number) = public.paper_key(c.doc_number) loop
      if (coalesce(x.doc_date, x.created_at::date), x.created_at) > (coalesce(c.doc_date, c.created_at::date), c.created_at) then
        newer := x; older := c;
      else
        newer := c; older := x;
      end if;
      label := format('%sconfirmation%s of %s', coalesce(vname || '''s ', ''), coalesce(' ' || nullif(newer.doc_number, ''), ''),
                      to_char(coalesce(newer.doc_date, newer.created_at::date), 'Mon DD, YYYY'));
      update public.order_checks set status = 'dismissed', reviewed_at = now(),
             read_note = left(format('Replaced by the newer %s (newer email wins).', label), 500)
       where id = older.id and status <> 'dismissed';
      update public.vendor_links set superseded_at = coalesce(superseded_at, now()), is_current = false where id = older.document_id and id <> newer.document_id;
      update public.item_changes set superseded_at = now(), superseded_note = format('Replaced by the newer %s.', label)
       where check_id = older.id and superseded_at is null and decision is null;
      update public.review_items r set status = 'accepted', resolved_at = now(), resolution_note = format('Closed by VMS: the newer %s replaced the paper this came from.', label)
        from public.item_changes ic where ic.check_id = older.id and r.id = ic.review_item_id and r.status = 'pending';
      replaced := replaced + 1;
      exit when older.id = c.id;
    end loop;
  end if;

  -- 2. backorders follow the order's newest paper (confirmation or invoice)
  select * into latest from public.order_checks
   where order_id = c.order_id and kind in ('confirmation', 'invoice') and status in ('comparing', 'to_review', 'done')
   order by coalesce(doc_date, created_at::date) desc, created_at desc limit 1;
  if latest.id is not null then
    label := format('%s%s%s of %s', coalesce(vname || '''s ', ''), latest.kind, coalesce(' ' || nullif(latest.doc_number, ''), ''),
                    to_char(coalesce(latest.doc_date, latest.created_at::date), 'Mon DD, YYYY'));
    update public.item_changes ic set superseded_at = now(), superseded_note = format('The newer %s does not list it on backorder.', label)
      from public.order_checks oc
     where ic.order_id = c.order_id and ic.read_as = 'backordered' and ic.superseded_at is null and ic.check_id <> latest.id
       and oc.id = ic.check_id and (coalesce(oc.doc_date, oc.created_at::date), oc.created_at) < (coalesce(latest.doc_date, latest.created_at::date), latest.created_at)
       and not exists (select 1 from public.item_changes l where l.check_id = latest.id and l.item_key = ic.item_key and l.read_as = 'backordered');
    get diagnostics cleared = row_count;
    select backorder into was_bo from public.orders where id = c.order_id;
    now_bo := exists (select 1 from public.item_changes where order_id = c.order_id and read_as = 'backordered' and superseded_at is null);
    if was_bo and not now_bo then
      update public.orders set backorder = false where id = c.order_id;
      closed := public.order_delay_tasks_close(c.order_id, format('Closed by VMS: the newer %s shows nothing left on backorder.', label));
    elsif now_bo and not coalesce(was_bo, false) then
      update public.orders set backorder = true where id = c.order_id;
    end if;
  end if;
  return format('replaced %s, backorders cleared %s, tasks closed %s', replaced, cleared, closed);
end;
$$;
revoke execute on function public.order_check_newer_wins(uuid) from public, anon, authenticated;
grant execute on function public.order_check_newer_wins(uuid) to service_role;

-- 3a. the order is on its way or in, with nothing on backorder → the delay tasks close
create or replace function public.orders_delay_tasks_close() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not new.backorder and new.status in ('shipped', 'received', 'entered', 'ready_to_pay', 'paid', 'cancelled')
     and (old.status is distinct from new.status or old.backorder is distinct from new.backorder) then
    perform public.order_delay_tasks_close(new.id, format('Closed by VMS: the order is %s with nothing on backorder.', replace(new.status::text, '_', ' ')));
  end if;
  return null;
end;
$$;
revoke execute on function public.orders_delay_tasks_close() from public, anon, authenticated;
drop trigger if exists orders_delay_tasks_close on public.orders;
create trigger orders_delay_tasks_close after update of status, backorder on public.orders for each row execute function public.orders_delay_tasks_close();

-- 3b. a newer email in the conversation shows it shipped (picked up, in transit, out for delivery, delivered) → the delay
--     tasks from that conversation close, unless its order still has items on backorder
create or replace function public.emails_delay_tasks_shipped() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.ship_status in ('picked_up', 'in_transit', 'out_for_delivery', 'delivered') and old.ship_status is distinct from new.ship_status then
    update public.tasks t set done_at = now(), done_note = left(format('Closed by VMS: a newer email in this conversation (%s) shows it %s.',
             to_char(new.received_at at time zone 'America/Los_Angeles', 'Mon DD, YYYY'), replace(new.ship_status, '_', ' ')), 500)
     where t.thread_id = new.thread_id and t.auto_key like 'shipupd:%' and t.done_at is null and t.created_at < new.received_at
       and not exists (select 1 from public.orders o where o.id = t.order_id and o.backorder);
  end if;
  return null;
end;
$$;
revoke execute on function public.emails_delay_tasks_shipped() from public, anon, authenticated;
drop trigger if exists emails_delay_tasks_shipped on public.emails;
create trigger emails_delay_tasks_shipped after update of ship_status on public.emails for each row execute function public.emails_delay_tasks_shipped();

-- Back-check: each order's papers once (the newest check of each order runs both rules)
select public.order_check_newer_wins(o.id)
  from (select distinct on (order_id) id, order_id from public.order_checks
         where order_id is not null and kind in ('confirmation', 'invoice') and status in ('comparing', 'to_review', 'done')
         order by order_id, coalesce(doc_date, created_at::date) desc, created_at desc) o;
-- every confirmation that shares its number with another on the same order (all revisions, not only the newest)
select public.order_check_newer_wins(c.id) from public.order_checks c
 where c.kind = 'confirmation' and c.order_id is not null and c.status in ('comparing', 'to_review', 'done')
   and exists (select 1 from public.order_checks x where x.order_id = c.order_id and x.kind = 'confirmation' and x.id <> c.id
                 and x.status in ('comparing', 'to_review', 'done', 'needs_order') and public.paper_key(x.doc_number) = public.paper_key(c.doc_number));
-- orders already on their way with nothing on backorder
select public.order_delay_tasks_close(o.id, format('Closed by VMS: the order is %s with nothing on backorder.', replace(o.status::text, '_', ' ')))
  from public.orders o
 where not o.backorder and o.status in ('shipped', 'received', 'entered', 'ready_to_pay', 'paid', 'cancelled')
   and exists (select 1 from public.tasks t where t.order_id = o.id and t.auto_key like 'shipupd:%' and t.done_at is null);
