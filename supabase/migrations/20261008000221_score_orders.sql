-- 0221 — The orders behind a vendor's automatic scores (Dana, Oct 21: "where it got its data needs to be accessible with
-- one click"). vendor_score_orders(vendor, dimension) lists the orders each scorecard line counts, with why, using the
-- same rules as vendor_scorecards (0003): fulfilment = late (received more than a week after the ship date), accuracy =
-- damage/shortage/wrong-item/tag notes, shipping = charged when it should ship free or late/lost notes, resolution =
-- credits owed. Read with the caller's own rights (orders RLS).

create or replace function public.vendor_score_orders(p_vendor uuid, p_dimension text)
returns table (order_id uuid, po_number text, order_date date, why text)
language sql stable set search_path = public as $$
  select o.id, o.po_number, o.order_date,
    case p_dimension
      when 'fulfilment' then 'received ' || (o.date_received - o.est_ship_date) || ' days after the ship date'
      when 'accuracy' then left(concat_ws(' · ', o.shipment_notes, o.credit_notes, o.notes), 160)
      when 'shipping' then case when o.freight_cost > 0 and (o.free_shipping or v.free_shipping_policy = 'always'
          or (v.free_shipping_policy = 'sometimes' and v.free_shipping_threshold is not null and coalesce(o.final_cost, o.est_cost) >= v.free_shipping_threshold))
        then 'charged ' || to_char(o.freight_cost, 'FM$999,990.00') || ' freight when it should ship free'
        else left(concat_ws(' · ', o.shipment_notes, o.credit_notes, o.freight_notes, o.notes), 160) end
      when 'resolution' then case when o.date_credits_received is not null then 'credit received ' || to_char(o.date_credits_received, 'Mon DD, YYYY') else 'credit still owed' end
        || coalesce(': ' || left(o.credit_notes, 120), '')
    end
  from public.orders o join public.vendors v on v.id = o.vendor_id
  where o.vendor_id = p_vendor and case p_dimension
    when 'fulfilment' then o.date_received is not null and o.est_ship_date is not null and o.date_received > o.est_ship_date + 7
    when 'accuracy' then concat_ws(' ', o.shipment_notes, o.credit_notes, o.notes)
      ~* '(damag|broken|crush|short(ed|age| ship)|missing|wrong|incorrect|mistake|\merror|double.?ship|wrong (item|qty|quantity|size|color|tags?)|hang ?tags?|(no|missing) tags?)'
    when 'shipping' then (o.freight_cost > 0 and (o.free_shipping or v.free_shipping_policy = 'always'
        or (v.free_shipping_policy = 'sometimes' and v.free_shipping_threshold is not null and coalesce(o.final_cost, o.est_cost) >= v.free_shipping_threshold)))
      or concat_ws(' ', o.shipment_notes, o.credit_notes, o.freight_notes, o.notes)
        ~* '(\mlate\M|delay|backorder|\mb/o\M|cancel|\mlost\M|never (arrived|received|shipped)|refus|no (response|answer)|did ?n.t (respond|reply|ship)|ignored|double.?(bill|charg)|overcharg|dispute)'
    when 'resolution' then o.credits_due
    else false end
  order by o.order_date desc nulls last
  limit 100
$$;
grant execute on function public.vendor_score_orders(uuid, text) to authenticated, service_role;
comment on function public.vendor_score_orders(uuid, text) is 'The orders behind one automatic scorecard line, with why (same rules as vendor_scorecards).';
