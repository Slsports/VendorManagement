-- 0275 — Duplicate orders (Dana, Oct 31, "go on all 3"):
--   1. World Famous WORLD020426 (Feb 4 show, "bibs, pants, jackets, snowboard bag, fleece", no amount) is SO 88198
--      entered twice (Dana: "Yes it is a dup"; SO 88198's confirmation has 42 bib lines, 22 pant lines, jackets, fleece):
--      its show and who placed it go onto the SO 88198 order and it is cancelled as a copy.
--   2. VMS looks for orders entered twice: same vendor, same show (or placed within a week), the same kinds of items
--      (at least two item words in common, half of the smaller order's), and not two different confirmation numbers
--      (Dana: at either show we may place a ship-now order and a ship-later order, each with its own confirmation; those
--      are two real orders; season alone never decides). At least one of the two still open. Each pair is a card for
--      Dana in the Review queue (Needs a hand): keep one (the other is cancelled, its papers, mail and tasks moved to the
--      one kept) or Not the same order. Nothing is cancelled without her answer. Daily, and once now.

set local lock_timeout = '5s';

-- the item words of an order: its description and its lines, plural trimmed, filler words left out
create or replace function public.order_item_words(p_order uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct w), '{}') from (
    select regexp_replace(w, '(ES|S)$', '') as w from (
      select unnest(regexp_split_to_array(upper(coalesce(o.description, '') || ' ' ||
               coalesce((select string_agg(coalesce(l.description, ''), ' ') from public.order_lines l where l.order_id = o.id), '')), '[^A-Z]+')) as w
        from public.orders o where o.id = p_order) x
     where length(w) >= 3 and w not in ('AND', 'THE', 'FOR', 'WITH', 'MEN', 'MENS', 'WOMEN', 'WOMENS', 'LADIES', 'LADY', 'KID', 'KIDS', 'YOUTH', 'BOYS',
           'GIRLS', 'ASST', 'ASSORTED', 'SIZE', 'COLOR', 'BLACK', 'WHITE', 'GREY', 'GRAY', 'BLUE', 'RED', 'NAVY', 'ORDER', 'SHOW', 'SPRING', 'FALL',
           'WINTER', 'SUMMER', 'MISC', 'VARIOUS', 'ITEMS', 'ITEM')) y
   where length(w) >= 3
$$;

-- one order folded into another: the details the kept one lacks, everything tied to the copy, the copy cancelled
create or replace function public.order_duplicate_merge(p_keep uuid, p_dup uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare k public.orders%rowtype; d public.orders%rowtype;
begin
  select * into k from public.orders where id = p_keep;
  select * into d from public.orders where id = p_dup;
  if k.id is null or d.id is null or k.id = d.id or k.vendor_id is distinct from d.vendor_id then raise exception 'Those are not two orders of one vendor' using errcode = '22023'; end if;
  update public.orders set show_code = coalesce(show_code, d.show_code), order_date = coalesce(order_date, d.order_date), season = coalesce(season, d.season),
         placed_by = coalesce(placed_by, d.placed_by), placed_by_id = coalesce(placed_by_id, d.placed_by_id), est_cost = coalesce(est_cost, d.est_cost),
         store_codes = case when cardinality(coalesce(store_codes, '{}')) = 0 then d.store_codes else store_codes end,
         notes = concat_ws(E'\n', nullif(notes, ''), format('Also entered as %s (%s) %s: %s', coalesce(d.po_number, 'no PO'), coalesce(d.description, 'no description'),
                                                            coalesce('on ' || to_char(d.order_date, 'FMMM/FMDD/YYYY'), ''), p_note))
   where id = p_keep;
  update public.vendor_links set order_id = p_keep where order_id = p_dup;
  update public.emails set order_id = p_keep where order_id = p_dup;
  update public.tasks set order_id = p_keep where order_id = p_dup;
  update public.email_drafts set order_id = p_keep where order_id = p_dup;
  update public.wwd_invoices set order_id = p_keep where order_id = p_dup;
  update public.freight_quotes set order_id = p_keep where order_id = p_dup;
  update public.freight_bill_lines set order_id = p_keep where order_id = p_dup;
  update public.delivery_receipts set order_id = p_keep where order_id = p_dup;
  update public.order_checks set order_id = p_keep where order_id = p_dup;
  update public.order_checks set suggested_order_id = p_keep where suggested_order_id = p_dup;
  update public.item_changes set order_id = p_keep where order_id = p_dup;
  update public.vendor_payments set order_id = p_keep where order_id = p_dup;
  update public.po_asks set order_id = p_keep where order_id = p_dup;
  update public.ordering_items set order_id = p_keep where order_id = p_dup;
  update public.needs set order_id = p_keep where order_id = p_dup;
  update public.ls_pos set order_id = p_keep where order_id = p_dup;
  if not exists (select 1 from public.order_lines where order_id = p_keep) then update public.order_lines set order_id = p_keep where order_id = p_dup; end if;
  if not exists (select 1 from public.shipment_requests where order_id = p_keep) then update public.shipment_requests set order_id = p_keep where order_id = p_dup; end if;
  update public.orders set status = 'cancelled',
         notes = concat_ws(E'\n', nullif(notes, ''), format('Duplicate of %s, cancelled %s: %s', coalesce(k.po_number, 'the other order'), to_char(current_date, 'FMMM/FMDD/YYYY'), p_note))
   where id = p_dup;
end;
$$;
revoke execute on function public.order_duplicate_merge(uuid, uuid, text) from public, anon, authenticated;

-- 1. World Famous
do $$
begin
  if exists (select 1 from public.orders where id = '74d95a3b-780b-4213-be5c-a11157369a52' and status <> 'cancelled')
     and exists (select 1 from public.orders where id = '1bcae7f1-9507-4a6f-b536-d8168c1ef022') then
    perform public.order_duplicate_merge('1bcae7f1-9507-4a6f-b536-d8168c1ef022', '74d95a3b-780b-4213-be5c-a11157369a52', 'the same order as SO 88198 (Dana, Oct 31)');
  end if;
end $$;

-- 2. the finder
create or replace function public.order_duplicate_scan(p_org uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0; v_who uuid := public.org_admin(p_org);
begin
  for r in
    with p as (
      select a.id as a, b.id as b, v.name as vn, a.po_number as pa, b.po_number as pb, a.status as sa, b.status as sb, a.order_date as da, b.order_date as db,
             a.description as dsa, b.description as dsb, a.est_cost as ea, b.est_cost as eb, a.show_code as sha, b.show_code as shb,
             public.order_item_words(a.id) as wa, public.order_item_words(b.id) as wb,
             (select array_agg(distinct public.po_norm(l.doc_number)) from public.vendor_links l where l.order_id = a.id and l.kind = 'confirmation' and l.doc_number is not null) as ca,
             (select array_agg(distinct public.po_norm(l.doc_number)) from public.vendor_links l where l.order_id = b.id and l.kind = 'confirmation' and l.doc_number is not null) as cb
        from public.orders a join public.orders b on b.vendor_id = a.vendor_id and a.id < b.id
        join public.vendors v on v.id = a.vendor_id
       where a.organization_id = p_org and a.status <> 'cancelled' and b.status <> 'cancelled'
         and (a.status in ('open', 'awaiting_confirmation', 'confirmed', 'shipped') or b.status in ('open', 'awaiting_confirmation', 'confirmed', 'shipped'))
         and ((a.show_code is not null and a.show_code = b.show_code) or abs(a.order_date - b.order_date) <= 7)
    )
    select p.*, array(select x from unnest(wa) x where x = any (wb)) as common from p
     where cardinality(wa) > 0 and cardinality(wb) > 0
       and (select count(*) from unnest(wa) x where x = any (wb)) >= 2
       and (select count(*) from unnest(wa) x where x = any (wb)) * 2 >= least(cardinality(wa), cardinality(wb))
       and not (ca is not null and cb is not null and not (ca && cb))
       and not exists (select 1 from public.review_items ri where ri.organization_id = p_org and ri.kind = 'order_duplicate'
                        and ri.details->>'pair' = p.a::text || ':' || p.b::text)
  loop
    insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details, assigned_to, assigned_at)
    values (p_org, 'order_duplicate', 'order', r.a,
            left(format('%s: the same order twice? %s and %s', r.vn, coalesce(r.pa, 'no PO'), coalesce(r.pb, 'no PO')), 200),
            jsonb_build_object('pair', r.a::text || ':' || r.b::text, 'vendor_name', r.vn,
              'a', jsonb_build_object('id', r.a, 'po', r.pa, 'status', r.sa, 'date', r.da, 'description', r.dsa, 'amount', r.ea, 'show', r.sha),
              'b', jsonb_build_object('id', r.b, 'po', r.pb, 'status', r.sb, 'date', r.db, 'description', r.dsb, 'amount', r.eb, 'show', r.shb),
              'common', r.common),
            v_who, case when v_who is not null then now() end);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.order_duplicate_scan(uuid) from public, anon, authenticated;
grant execute on function public.order_duplicate_scan(uuid) to service_role;

-- Dana's answer: keep one (the other is folded in and cancelled), or not the same order
create or replace function public.order_duplicate_answer(p_item uuid, p_keep uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.review_items%rowtype; a uuid; b uuid;
begin
  select * into r from public.review_items where id = p_item for update;
  if r.id is null or r.kind <> 'order_duplicate' then raise exception 'Card not found' using errcode = '23503'; end if;
  if not (public.user_in_org(r.organization_id) and public.user_can_edit()) then raise exception 'Only admins, managers and buyers answer this' using errcode = '42501'; end if;
  if r.status <> 'pending' then return; end if;
  a := (r.details->'a'->>'id')::uuid; b := (r.details->'b'->>'id')::uuid;
  if p_keep is null then
    update public.review_items set status = 'rejected', resolved_by = auth.uid(), resolved_at = now(), resolution_note = 'Not the same order: both kept' where id = p_item;
    return;
  end if;
  if p_keep not in (a, b) then raise exception 'Pick one of the two orders' using errcode = '22023'; end if;
  perform public.order_duplicate_merge(p_keep, case when p_keep = a then b else a end,
                                       'the same order (' || coalesce((select full_name from public.profiles where id = auth.uid()), 'confirmed') || ', ' || to_char(current_date, 'FMMM/FMDD/YYYY') || ')');
  update public.review_items set status = 'accepted', resolved_by = auth.uid(), resolved_at = now(),
         resolution_note = 'Kept ' || coalesce((select po_number from public.orders where id = p_keep), 'one order') || '; the other cancelled as a copy'
   where id = p_item;
end;
$$;
revoke execute on function public.order_duplicate_answer(uuid, uuid) from public, anon;
grant execute on function public.order_duplicate_answer(uuid, uuid) to authenticated, service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'order-duplicates';
    perform cron.schedule('order-duplicates', '23 12 * * *', 'select public.order_duplicate_scan(id) from public.organizations');
  end if;
end $$;

select public.order_duplicate_scan(id) from public.organizations;
