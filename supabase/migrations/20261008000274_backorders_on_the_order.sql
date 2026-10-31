-- 0274 — Dana, Oct 31 ("go, just show backorders on the order"): an item the vendor says is backordered (it still ships
-- later on the same order: WFS's SO 88198-2, -3 …; Okuma's "B/O 2") is not a decision. It shows on the order under On
-- backorder, the order is marked Backorder, and nothing is written to Lightspeed. Only items the vendor says are
-- discontinued, replaced, or out of stock with no plan to ship them on this order make a card.
-- Back-check: every open card read from a confirmation whose vendor words say backorder (World Famous 18, Okuma 1).

set local lock_timeout = '5s';

alter table public.item_changes drop constraint if exists item_changes_read_as_check;
alter table public.item_changes add constraint item_changes_read_as_check check (read_as in ('discontinued', 'replaced', 'out_of_stock', 'unclear', 'backordered'));

create or replace function public.item_changes_from_check(p_check uuid, p_items jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  c   public.order_checks%rowtype;
  v   public.vendors%rowtype;
  it  jsonb;
  k   text;
  ch  public.item_changes%rowtype;
  li_id   text;
  li_name text;
  rid uuid;
  n   integer := 0;
begin
  select * into c from public.order_checks where id = p_check;
  if not found then return 0; end if;
  select * into v from public.vendors where id = c.vendor_id;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    k := upper(coalesce(nullif(trim(it->>'vendor_item_id'), ''), left(trim(coalesce(it->>'item_name', '')), 80)));
    if k = '' or (it->>'read_as') is null then continue; end if;
    li_id := null; li_name := null;
    if v.lightspeed_vendor_id is not null and nullif(trim(it->>'vendor_item_id'), '') is not null then
      select i.item_id, i.description into li_id, li_name from public.ls_items i
       where i.organization_id = c.organization_id and i.default_vendor_id = v.lightspeed_vendor_id
         and upper(i.vendor_item_id) = upper(trim(it->>'vendor_item_id'))
       order by i.archived, i.item_id limit 1;
    end if;
    insert into public.item_changes (organization_id, vendor_id, order_id, check_id, item_key, vendor_item_id, item_name, read_as, sure,
                                     replacement_vendor_item_id, replacement_name, replacement_price, back_date, vendor_words, ls_item_id, ls_name)
    values (c.organization_id, c.vendor_id, c.order_id, c.id, k, nullif(trim(it->>'vendor_item_id'), ''), nullif(trim(it->>'item_name'), ''),
            it->>'read_as', coalesce((it->>'sure')::boolean, false), nullif(trim(it->>'replacement_vendor_item_id'), ''),
            nullif(trim(it->>'replacement_name'), ''), (it->>'replacement_price')::numeric,
            case when it->>'back_date' ~ '^\d{4}-\d{2}-\d{2}$' then (it->>'back_date')::date end,
            left(nullif(trim(it->>'vendor_words'), ''), 500), li_id, li_name)
    on conflict (check_id, item_key) do update set
      vendor_item_id = excluded.vendor_item_id, item_name = excluded.item_name, read_as = excluded.read_as, sure = excluded.sure,
      replacement_vendor_item_id = excluded.replacement_vendor_item_id, replacement_name = excluded.replacement_name,
      replacement_price = excluded.replacement_price, back_date = excluded.back_date, vendor_words = excluded.vendor_words,
      ls_item_id = coalesce(excluded.ls_item_id, item_changes.ls_item_id), ls_name = coalesce(excluded.ls_name, item_changes.ls_name)
     where item_changes.decision is null
    returning * into ch;
    if ch.id is null then continue; end if;
    n := n + 1;
    if ch.read_as = 'backordered' then
      -- on the order, not a decision
      if c.order_id is not null then update public.orders set backorder = true where id = c.order_id and not backorder; end if;
    elsif ch.review_item_id is null and ch.decision is null then
      insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details, assigned_to, assigned_at)
      values (c.organization_id, 'item_change', 'vendor', c.vendor_id,
              format('%s: %s %s', coalesce(v.name, 'Vendor'), coalesce(ch.vendor_item_id || ' ', ''),
                     case ch.read_as when 'replaced' then 'replaced' when 'discontinued' then 'discontinued'
                                     when 'out_of_stock' then 'out of stock' else 'may not be available' end),
              jsonb_build_object('change_id', ch.id, 'check_id', c.id, 'order_id', c.order_id, 'vendor_id', c.vendor_id,
                                 'vendor_name', v.name, 'vendor_id_for_rules', c.vendor_id),
              c.assigned_to, case when c.assigned_to is not null then now() end)
      returning id into rid;
      update public.item_changes set review_item_id = rid where id = ch.id;
    end if;
    ch := null;
  end loop;
  return n;
end;
$function$;

-- a check tied to its order later: its backorders follow it
create or replace function public.order_checks_backorders_follow() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.item_changes set order_id = new.order_id where check_id = new.id and read_as = 'backordered' and order_id is distinct from new.order_id;
  if new.order_id is not null and exists (select 1 from public.item_changes where check_id = new.id and read_as = 'backordered') then
    update public.orders set backorder = true where id = new.order_id and not backorder;
  end if;
  return null;
end;
$$;
drop trigger if exists order_checks_backorders_follow on public.order_checks;
create trigger order_checks_backorders_follow after update of order_id on public.order_checks for each row execute function public.order_checks_backorders_follow();

-- back-check: open cards from confirmations that say backorder
with b as (
  update public.item_changes ic set read_as = 'backordered', order_id = coalesce(ic.order_id, c.order_id)
    from public.order_checks c
   where c.id = ic.check_id and ic.decision is null and ic.source = 'confirmation'
     and ic.vendor_words ~* '(back ?order|\mb/o\M|ship(s|ping)? later)'
  returning ic.review_item_id, ic.order_id
), closed as (
  update public.review_items r set status = 'accepted', resolved_at = now(),
         resolution_note = 'Backordered: shows on the order under On backorder (Dana, Oct 31), not a decision.'
    from b where r.id = b.review_item_id and r.status = 'pending'
  returning r.id
)
update public.orders o set backorder = true from (select distinct order_id from b where order_id is not null) x where o.id = x.order_id and not o.backorder;
