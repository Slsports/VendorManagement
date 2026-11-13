-- 0374 — Reef Sport is one vendor (Dana, Nov 13: "Reef Sport is a line of sunscreen and sun skin care products that we buy
-- from the rep group Sandboxx group. I originally found them on Faire, and then I found they also belonged to wwd. I work
-- directly with the owner of Sandbox and order via email with him and pay via bill.com. thats how I will continue to do it."
-- … "Keep it under reef sport, go on all").
--   • SANDBOXX GROUP LLC, SANDBOXX (old Faire name) and "FAIRE/SANDBOXX/REEF SPORT SUNCARE" (made by the Nov 13 sheet load)
--     are merged into REEF SPORT SUNCARE: everything that points at them (emails, mail threads, files, tasks, payments,
--     invoices, reports, contacts …) moves; their names become aliases so sheets, mail and Bill.com still match.
--   • Direct is the usual route; Bill.com sending and checking carry over from the Sandboxx record.
--   • Every order that was in VMS twice (once under Sandboxx, once under Reef Sport: same date and cost) is merged into one
--     with both records' notes (0373).
set local lock_timeout = '5s';

do $$
declare v_keep constant uuid := '10bd730a-d8b9-46e1-9f43-a9ae06abad5b'; v_rm uuid; r record; x record; g record; i int;
        v_test constant uuid := '723243ca-f98f-4fd7-b964-51432610e3a1'; -- "Claude (testing)", an admin (never Dana's login)
begin
  if not exists (select 1 from public.vendors where id = v_keep) or not exists (select 1 from public.profiles where id = v_test) then return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_test, 'role', 'authenticated')::text, true);

  foreach v_rm in array array['0dc77589-f53c-4939-8a7b-ab3f8e9cff24', 'adacf219-8552-4de5-b24e-8df52f7bf87e', '46d68f56-ed99-467a-b458-df711c05125b']::uuid[] loop
    continue when not exists (select 1 from public.vendors where id = v_rm);
    -- every row that points at the merged record moves (a row the kept vendor already has, like the same contact, stays behind)
    for r in select c.conrelid::regclass::text as tbl, a.attname as col
               from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
              where c.contype = 'f' and c.confrelid = 'public.vendors'::regclass
                and (c.conrelid::regclass::text, a.attname::text) not in (('vendor_merges', 'kept_vendor_id'), ('vendor_merges', 'merged_vendor_id'), ('public.vendor_merges', 'kept_vendor_id'), ('public.vendor_merges', 'merged_vendor_id')) loop
      begin
        execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col) using v_keep, v_rm;
      exception when unique_violation then
        for x in execute format('select ctid from %s where %I = $1', r.tbl, r.col) using v_rm loop
          begin
            execute format('update %s set %I = $1 where ctid = $2', r.tbl, r.col) using v_keep, x.ctid;
          exception when unique_violation then null;
          end;
        end loop;
      end;
    end loop;
    update public.vendors k set billcom_send = k.billcom_send or m.billcom_send, billcom_check = k.billcom_check or m.billcom_check,
           billcom_pay_where = coalesce(k.billcom_pay_where, m.billcom_pay_where), billcom_auto_on_from = coalesce(k.billcom_auto_on_from, m.billcom_auto_on_from)
      from public.vendors m where k.id = v_keep and m.id = v_rm;
    -- names, aliases, the merge record and the inactive mark
    perform public.merge_vendors(v_keep, v_rm, 'direct'::public.billing_route);
  end loop;
  update public.vendors set notes = concat_ws(E'\n', nullif(notes, ''),
           'Reef Sport is a line we buy from the rep group Sandboxx Group: ordered by email with its owner, paid through Bill.com (Dana, Nov 13, 2026). First found on Faire; also at WWD.')
   where id = v_keep and coalesce(notes, '') not like '%rep group Sandboxx Group%';

  -- the orders that were in VMS twice: one order each, notes from both
  for g in select order_date, est_cost, array_agg(id order by (source = 'placed_order_summary') desc, created_at) as ids
             from public.orders where vendor_id = v_keep and status <> 'cancelled' and order_date is not null and est_cost is not null
            group by order_date, est_cost having count(*) > 1 loop
    for i in 2 .. cardinality(g.ids) loop
      perform public.order_duplicate_merge(g.ids[1], g.ids[i], 'Reef Sport was in VMS under three names (Sandboxx Group, Reef Sport, Faire); the same order (Dana, Nov 13).');
    end loop;
  end loop;
  perform set_config('request.jwt.claims', '', true);
end $$;
