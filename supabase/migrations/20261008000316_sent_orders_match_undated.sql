-- Sent orders match an undated order whose items line up (Dana, Nov 5: "GO ON THAT"). The Planet Cotton hoodie emails
-- had added a new order next to PO 26328, paid, from the order guide with no date: the sent-mail reader only took an
-- undated order while it was still open. Now, after the PO and the date match, it takes the vendor's undated order
-- (any status but cancelled) whose item words line up the way the duplicate scan judges it, when one candidate is
-- clearly the best. Lines on an order past confirmed are never touched (the function keeps fill mode).

-- the words of a description or a list of items, as order_item_words judges them. A trailing S and then a trailing E
-- come off, so HOODIE and HOODIES, BOX and BOXES, LURE and LURES are the same word (the old (ES|S) rule made HOODIES
-- "HOODI" and HOODIE "HOODIE": the Planet Cotton hoodie lines did not match).
create or replace function public.text_item_words(p_text text) returns text[]
language sql immutable as $$
  select coalesce(array_agg(distinct w), '{}') from (
    select regexp_replace(regexp_replace(w, 'S$', ''), 'E$', '') as w from (
      select unnest(regexp_split_to_array(upper(coalesce(p_text, '')), '[^A-Z]+')) as w) x
     where length(w) >= 3 and w not in ('AND', 'THE', 'FOR', 'WITH', 'MEN', 'MENS', 'WOMEN', 'WOMENS', 'LADIES', 'LADY', 'KID', 'KIDS', 'YOUTH', 'BOYS',
           'GIRLS', 'ASST', 'ASSORTED', 'SIZE', 'COLOR', 'BLACK', 'WHITE', 'GREY', 'GRAY', 'BLUE', 'RED', 'NAVY', 'ORDER', 'SHOW', 'SPRING', 'FALL',
           'WINTER', 'SUMMER', 'MISC', 'VARIOUS', 'ITEMS', 'ITEM')) y
   where length(w) >= 3
$$;

create or replace function public.order_item_words(p_order uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select public.text_item_words(coalesce(o.description, '') || ' ' ||
           coalesce((select string_agg(coalesce(l.description, ''), ' ') from public.order_lines l where l.order_id = o.id), ''))
    from public.orders o where o.id = p_order
$$;

-- The vendor's undated order whose items line up with p_text (our order's description and item lines): at least two
-- words in common and the common words covering half of the shorter list. Null when none, or when two tie for best.
create or replace function public.order_match_undated(p_vendor uuid, p_text text) returns uuid
language sql stable security definer set search_path = public as $$
  with want as (select public.text_item_words(p_text) as w),
  c as (
    select o.id, (select count(*) from unnest(public.order_item_words(o.id)) x where x = any (want.w)) as common,
           cardinality(public.order_item_words(o.id)) as n
      from public.orders o, want
     where o.vendor_id = p_vendor and o.order_date is null and o.status <> 'cancelled' and cardinality(want.w) > 0
  ),
  ok as (select * from c, want where common >= 2 and common * 2 >= least(n, cardinality(want.w)))
  select id from ok
   where common = (select max(common) from ok)
     and (select count(*) from ok x where x.common = ok.common) = 1
$$;

revoke execute on function public.text_item_words(text), public.order_match_undated(uuid, text) from public, anon, authenticated;
grant execute on function public.text_item_words(text) to authenticated, service_role;
grant execute on function public.order_match_undated(uuid, text) to service_role;
