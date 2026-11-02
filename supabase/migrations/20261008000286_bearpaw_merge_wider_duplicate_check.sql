-- 0286 — Bearpaw's three copies of one order, and why the duplicate check missed them (Dana, Nov 2): "Can you find out WHY
-- there are 3 orders listed for the same order for $1350 for Bearclaw? This order was placed at the feb 2026 show and was
-- shipped in late aug or sept" … "there are actually 4 entries in the dropdown for orders" … "go on all of it, keep B671841
-- as the PO".
--   • The copies: BEARPAW020426 (Seasonal Buying Guide, Oct 6), 297880 (Placed Order Summary tab 2, Oct 9; paid through WWD,
--     invoice 3034206) and B671841 (made Oct 15 from Bearpaw's resent Aug 10 confirmation 2978800, dated Aug 10 though it was
--     placed Feb 4 at the WWD show). Merged into B671841: Feb 4, the WWD spring 2026 show, paid through WWD Oct 8; the other
--     two cancelled as copies with everything on them moved over. The 2024 order 2162661 is a real, separate order.
--   • The check only compared orders from the same show or a week apart, so the Aug 10 copy was never compared. It now also
--     pairs a confirmation number with a PO that is the same give or take a trailing digit, and the same amount within eight
--     months when the items agree (or one has none). Back-check: the whole order list again; new pairs are review cards.
set local lock_timeout = '5s';

create or replace function public.order_duplicate_scan(p_org uuid) returns integer
language plpgsql security definer set search_path = public as $function$
declare r record; n integer := 0; v_who uuid := public.org_admin(p_org);
begin
  for r in
    with p as (
      select a.id as a, b.id as b, v.name as vn, a.po_number as pa, b.po_number as pb, a.status as sa, b.status as sb, a.order_date as da, b.order_date as db,
             a.description as dsa, b.description as dsb, a.est_cost as ea, b.est_cost as eb, a.show_code as sha, b.show_code as shb,
             public.order_item_words(a.id) as wa, public.order_item_words(b.id) as wb,
             (select array_agg(distinct public.po_norm(l.doc_number)) from public.vendor_links l where l.order_id = a.id and l.kind = 'confirmation' and l.doc_number is not null) as ca,
             (select array_agg(distinct public.po_norm(l.doc_number)) from public.vendor_links l where l.order_id = b.id and l.kind = 'confirmation' and l.doc_number is not null) as cb,
             coalesce(a.order_date, public.po_date(a.po_number), a.created_at::date) as pla, coalesce(b.order_date, public.po_date(b.po_number), b.created_at::date) as plb
        from public.orders a join public.orders b on b.vendor_id = a.vendor_id and a.id < b.id
        join public.vendors v on v.id = a.vendor_id
       where a.organization_id = p_org and a.status <> 'cancelled' and b.status <> 'cancelled'
         and (a.status in ('open', 'awaiting_confirmation', 'confirmed', 'shipped') or b.status in ('open', 'awaiting_confirmation', 'confirmed', 'shipped'))
    ), q as (
      select p.*,
             (select count(*) from unnest(wa) x where x = any (wb)) as ncommon,
             -- placed together: the same show, or a week apart
             ((sha is not null and sha = shb) or abs(da - db) <= 7) as close,
             -- one order's confirmation number is the other's PO, give or take a trailing digit (Bearpaw 2978800 / 297880; Nov 2)
             (exists (select 1 from unnest(coalesce(ca, '{}')) x where length(x) >= 6 and length(public.po_norm(pb)) >= 6 and (x like public.po_norm(pb) || '%' or public.po_norm(pb) like x || '%'))
              or exists (select 1 from unnest(coalesce(cb, '{}')) x where length(x) >= 6 and length(public.po_norm(pa)) >= 6 and (x like public.po_norm(pa) || '%' or public.po_norm(pa) like x || '%'))) as conf_po,
             -- the same amount within eight months (the date VMS has can be when a confirmation was resent, not when it was placed)
             (ea is not null and ea = eb and ea >= 100 and abs(pla - plb) <= 240) as same_amount
        from p
    )
    select q.*, array(select x from unnest(wa) x where x = any (wb)) as common from q
     where ((close and cardinality(wa) > 0 and cardinality(wb) > 0 and ncommon >= 2 and ncommon * 2 >= least(cardinality(wa), cardinality(wb)))
            or conf_po
            or (same_amount and (ncommon >= 1 or cardinality(wa) = 0 or cardinality(wb) = 0)))
       and not (ca is not null and cb is not null and not (ca && cb) and not conf_po)
       and not exists (select 1 from public.review_items ri where ri.organization_id = p_org and ri.kind = 'order_duplicate'
                        and ri.details->>'pair' = q.a::text || ':' || q.b::text)
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
$function$;

-- Bearpaw: keep B671841
update public.orders set order_date = date '2026-02-04', show_code = coalesce(show_code, 'wwd_spring_2026')
 where id = '195da550-b18c-4d74-a917-e75fa548aac0' and po_number = 'B671841';
select public.order_duplicate_merge('195da550-b18c-4d74-a917-e75fa548aac0', d.id, 'the same Bearpaw show order (Dana, 11/2/2026: keep B671841)')
  from public.orders d where d.id in ('c98e55cf-01b4-4bf6-b1c0-5bf4b1917323', 'b7fcf957-a920-40c7-a88c-7f78acdc228f') and d.status <> 'cancelled'
   and exists (select 1 from public.orders k where k.id = '195da550-b18c-4d74-a917-e75fa548aac0');
update public.orders k set status = 'paid', paid_via = d.paid_via, paid_date = d.paid_date, paid_ref = coalesce(k.paid_ref, d.paid_ref), ok_to_pay = true
  from public.orders d
 where k.id = '195da550-b18c-4d74-a917-e75fa548aac0' and d.id = 'c98e55cf-01b4-4bf6-b1c0-5bf4b1917323' and d.paid_date is not null and k.paid_date is null;
update public.review_items set status = 'accepted', resolved_at = now(),
       resolution_note = 'Closed at Dana''s request (11/2/2026): all three Bearpaw entries are one order, kept as B671841'
 where kind = 'order_duplicate' and status = 'pending'
   and (details->'a'->>'id' in ('c98e55cf-01b4-4bf6-b1c0-5bf4b1917323', 'b7fcf957-a920-40c7-a88c-7f78acdc228f', '195da550-b18c-4d74-a917-e75fa548aac0')
     or details->'b'->>'id' in ('c98e55cf-01b4-4bf6-b1c0-5bf4b1917323', 'b7fcf957-a920-40c7-a88c-7f78acdc228f', '195da550-b18c-4d74-a917-e75fa548aac0'));

-- Back-check: the whole order list with the wider check.
select public.order_duplicate_scan(id) from public.organizations;
