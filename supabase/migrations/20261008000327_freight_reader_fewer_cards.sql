-- 0327 — Fewer, truer freight cards (Dana, Nov 9: "yes, close the 13 and fix the reader"). Of the first 36 cards, 13 were
-- our own carrier prices, repeats or promotions. Now:
--   • A freight amount from our own email is never their quote (Becker's TForce price, Master Fishing's UPS rate).
--   • One card for the same words from the same vendor, whatever the conversation (repeats in replies and forwards).
--   • One reading per order per email (Franklin's "free" and "free over $2,000" from one sentence); a quoted amount may
--     sit beside it.
--   • No "$0.00" amounts, and no "free over" under $100 ("36 pairs" and "25 or more" are not dollars).
set local lock_timeout = '5s';

create or replace function public.freight_promises_save(p_email uuid, p_items jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare e public.emails%rowtype; t public.email_threads%rowtype; x jsonb; p public.freight_promises%rowtype; o public.orders%rowtype;
        n integer := 0; v_terms text; v_vendor uuid; v_vn text; v_card uuid; v_amt numeric; v_over numeric; v_cap numeric;
begin
  select * into e from public.emails where id = p_email;
  if e.id is null then return 0; end if;
  select * into t from public.email_threads where id = e.thread_id;
  v_vendor := coalesce(e.vendor_id, t.vendor_id);
  select name into v_vn from public.vendors where id = v_vendor;
  for x in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    v_terms := x->>'terms';
    continue when v_terms is null or v_terms not in ('free', 'free_over', 'half', 'capped', 'charged', 'quoted');
    v_amt := nullif(x->>'amount', '')::numeric; v_over := nullif(x->>'free_over', '')::numeric; v_cap := nullif(x->>'cap_pct', '')::numeric;
    if v_amt is not null and v_amt <= 0 then v_amt := null; end if;
    continue when v_terms = 'quoted' and (v_amt is null or x->>'said_by' = 'us');
    continue when v_terms = 'free_over' and (v_over is null or v_over < 100);
    -- the same words from the same vendor already have a card (a reply or forward repeats them)
    continue when v_vendor is not null and exists (select 1 from public.freight_promises q
                           where q.organization_id = e.organization_id and q.vendor_id = v_vendor
                             and lower(regexp_replace(left(q.quote, 160), '\s+', ' ', 'g')) = lower(regexp_replace(left(coalesce(x->>'quote', ''), 160), '\s+', ' ', 'g'))
                             and coalesce(x->>'quote', '') <> '');
    -- one reading per order per email; a quoted amount may sit beside it
    continue when v_terms <> 'quoted' and exists (select 1 from public.freight_promises q
                           where q.email_id = e.id and q.terms <> 'quoted' and coalesce(q.po_text, '') = coalesce(nullif(trim(x->>'po'), ''), ''));
    -- one card per conversation for the same terms (any answer given stands)
    continue when exists (select 1 from public.freight_promises q
                           where q.organization_id = e.organization_id and q.terms = v_terms
                             and (q.thread_id = e.thread_id or q.email_id = e.id)
                             and q.free_over is not distinct from v_over and q.cap_pct is not distinct from v_cap and q.amount is not distinct from v_amt);
    insert into public.freight_promises (organization_id, email_id, thread_id, vendor_id, po_text, terms, basis, free_over, cap_pct, amount, said_by, quote, said_on, status)
      values (e.organization_id, e.id, e.thread_id, v_vendor, nullif(trim(x->>'po'), ''), v_terms,
              case when x->>'basis' in ('show_special', 'minimum_met', 'negotiated', 'always', 'other') then x->>'basis' end,
              v_over, v_cap, v_amt, case when x->>'said_by' = 'us' then 'us' else 'vendor' end, left(coalesce(x->>'quote', ''), 400), e.received_at, 'review')
      returning * into p;
    n := n + 1;
    o := null;
    select * into o from public.orders where id = public.freight_promise_order(p.id);
    if o.id is not null then
      update public.freight_promises set order_id = o.id where id = p.id returning * into p;
      if public.freight_promise_matches(p, o) then
        update public.freight_promises set status = 'matches' where id = p.id;
        continue;
      end if;
    end if;
    insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details, assigned_to, assigned_at)
      values (e.organization_id, 'freight_terms', 'freight_promise', p.id,
              left(coalesce(v_vn, 'A vendor') || ': ' || public.freight_promise_text(p)
                   || case when o.id is not null then ' on PO ' || coalesce(o.po_number, '(no PO)') when p.po_text is not null then ' (they wrote ' || p.po_text || ')' else '' end, 200),
              jsonb_build_object('vendor_id', v_vendor, 'vendor_name', v_vn, 'terms_text', public.freight_promise_text(p), 'quote', p.quote,
                                 'said_by', p.said_by, 'po_text', p.po_text, 'email_id', e.id, 'thread_id', e.thread_id, 'said_on', e.received_at,
                                 'order_id', o.id, 'order_po', o.po_number, 'order_date', o.order_date, 'order_cost', o.est_cost,
                                 'order_terms', case when o.id is not null then public.order_freight_terms(o) end),
              o.placed_by_id, case when o.placed_by_id is not null then now() end)
      returning id into v_card;
    update public.freight_promises set review_item_id = v_card where id = p.id;
  end loop;
  update public.emails set freight_read_at = now() where id = e.id;
  return n;
end $$;
revoke execute on function public.freight_promises_save(uuid, jsonb) from public, anon;
grant execute on function public.freight_promises_save(uuid, jsonb) to service_role;
