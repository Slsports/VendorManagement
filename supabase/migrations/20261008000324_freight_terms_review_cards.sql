-- 0324 — Freight terms from email become review cards (Dana, Nov 9: "yes, rebuild it as review cards").
-- 0322 put Claude's reading straight on the order; 5 of 21 were wrong, so it was paused. Now:
--   • Each reading is a card in Review › Freight: the terms, the vendor's exact words, their email one click away, the order
--     VMS thinks it is for, and the vendor's other orders. A person clicks Put it on this order (any of them) or Not for an
--     order. Nothing touches an order without that click. The terms then show on the order with the email as the source.
--   • No card when the order already says the same thing, and one card per conversation for the same terms (Master
--     Fishing's half-freight program was 7 tasks, Western Woods' $2,500 note 3).
--   • A PO only matches an order of that vendor, a brand it sells, or a vendor of the same rep group (Sandboxx is Reef
--     Sport's rep group, Dana Nov 9).
--   • Done means closed: a card closes itself when the order's freight is set to the same terms by any route.
--   • Back-check: the 53 readings that had no order (their "Which order?" tasks were closed at Dana's request) are removed
--     and their emails, plus every email that gave nothing, are read again with the tighter reader.
--   • A credit received from a WWD vendor waits for Edenred without a due date: "Waiting for WWD to post <vendor> credit
--     <number> (<amount>)" (Dana, Nov 9: "re-word it so it's not late").
set local lock_timeout = '5s';

alter table public.freight_promises drop constraint if exists freight_promises_status_check;
alter table public.freight_promises add constraint freight_promises_status_check
  check (status in ('review', 'matches', 'applied', 'needs_order', 'person_set', 'superseded', 'not_an_order'));
alter table public.freight_promises add column if not exists review_item_id uuid references public.review_items(id) on delete set null;

-- "Free freight over $1,000.00" in plain words
create or replace function public.freight_promise_text(p public.freight_promises) returns text
language sql immutable set search_path = public as $$
  select case p.terms
    when 'free' then 'Free freight'
    when 'free_over' then 'Free freight over ' || coalesce(public.money_text(p.free_over), 'a minimum')
    when 'half' then 'Half freight'
    when 'capped' then 'Freight capped at ' || coalesce(p.cap_pct::text || '%', 'a percent')
    when 'charged' then 'We pay the freight' || coalesce(' (' || public.money_text(p.amount) || ')', '')
    when 'quoted' then 'Freight quoted at ' || coalesce(public.money_text(p.amount), 'an amount')
  end
$$;
revoke execute on function public.freight_promise_text(public.freight_promises) from public, anon;
grant execute on function public.freight_promise_text(public.freight_promises) to authenticated, service_role;

-- does the order already say this?
create or replace function public.freight_promise_matches(p public.freight_promises, o public.orders) returns boolean
language sql stable set search_path = public as $$
  select case p.terms
    when 'quoted' then o.freight_quote_amount is not null and o.freight_quote_amount = p.amount
    when 'free_over' then o.free_over is not null and o.free_over = p.free_over
    when 'capped' then public.order_freight_terms(o) = 'capped' and o.freight_cap_pct is not distinct from p.cap_pct
    else public.order_freight_terms(o) = p.terms and (o.free_shipping is not null or o.freight_terms is not null)
  end
$$;
revoke execute on function public.freight_promise_matches(public.freight_promises, public.orders) from public, anon;
grant execute on function public.freight_promise_matches(public.freight_promises, public.orders) to service_role;

-- an order this vendor's email can speak for: theirs, a brand they sell, or a vendor of the same rep group
create or replace function public.freight_promise_vendor_ok(p_vendor uuid, o public.orders) returns boolean
language sql stable security definer set search_path = public as $$
  select p_vendor is null or o.vendor_id = p_vendor or o.brand_vendor_id = p_vendor
      or exists (select 1 from public.vendors a join public.vendors b on b.rep_group_id = a.rep_group_id
                  where a.id = p_vendor and b.id = o.vendor_id and a.rep_group_id is not null)
$$;
revoke execute on function public.freight_promise_vendor_ok(uuid, public.orders) from public, anon;
grant execute on function public.freight_promise_vendor_ok(uuid, public.orders) to service_role;

create or replace function public.freight_promise_order(p_promise uuid) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare p public.freight_promises%rowtype; e public.emails%rowtype; v_id uuid; n integer;
begin
  select * into p from public.freight_promises where id = p_promise;
  select * into e from public.emails where id = p.email_id;
  if public.po_key(p.po_text) is not null then
    select count(*), min(o.id::text)::uuid into n, v_id from public.orders o
     where o.organization_id = p.organization_id and o.status <> 'cancelled' and public.po_key(o.po_number) = public.po_key(p.po_text)
       and public.freight_promise_vendor_ok(p.vendor_id, o);
    if n = 1 then return v_id; end if;
  end if;
  if e.order_id is not null and exists (select 1 from public.orders o where o.id = e.order_id and o.status <> 'cancelled' and public.freight_promise_vendor_ok(p.vendor_id, o)) then
    return e.order_id;
  end if;
  select count(distinct x.order_id), min(x.order_id::text)::uuid into n, v_id from public.emails x join public.orders o on o.id = x.order_id
   where x.thread_id = e.thread_id and o.status <> 'cancelled' and public.freight_promise_vendor_ok(p.vendor_id, o);
  if n = 1 then return v_id; end if;
  return null;
end $$;
revoke execute on function public.freight_promise_order(uuid) from public, anon;
grant execute on function public.freight_promise_order(uuid) to service_role;

-- the reader's findings for one email (gmail-sync): saved as cards for a person; nothing goes on an order here
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
    continue when v_terms = 'quoted' and v_amt is null;
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

-- the card's answer: Put it on this order (p_order), or Not for an order (null)
create or replace function public.freight_terms_review_answer(p_item uuid, p_order uuid) returns text
language plpgsql security definer set search_path = public as $$
declare r public.review_items%rowtype; p public.freight_promises%rowtype; o public.orders%rowtype; v_res text;
begin
  select * into r from public.review_items where id = p_item for update;
  if r.id is null or r.kind <> 'freight_terms' then raise exception 'Card not found' using errcode = '23503'; end if;
  if not (public.user_in_org(r.organization_id) and public.user_can_edit()) then raise exception 'Only admins, managers and buyers answer this' using errcode = '42501'; end if;
  if r.status <> 'pending' then return 'done'; end if;
  select * into p from public.freight_promises where id = r.entity_id;
  if p_order is null then
    update public.freight_promises set status = 'not_an_order' where id = p.id;
    update public.review_items set status = 'rejected', resolved_by = auth.uid(), resolved_at = now(), resolution_note = 'Not for an order' where id = p_item;
    return 'not_an_order';
  end if;
  select * into o from public.orders where id = p_order;
  if o.id is null or o.organization_id <> r.organization_id then raise exception 'Order not found' using errcode = '23503'; end if;
  update public.freight_promises set order_id = o.id where id = p.id;
  v_res := public.freight_promise_apply(p.id, o.id, auth.uid());
  update public.review_items set status = 'accepted', resolved_by = auth.uid(), resolved_at = now(),
         resolution_note = public.freight_promise_text(p) || ' put on PO ' || coalesce(o.po_number, '(no PO)')
   where id = p_item;
  return v_res;
end $$;
revoke execute on function public.freight_terms_review_answer(uuid, uuid) from public, anon;
grant execute on function public.freight_terms_review_answer(uuid, uuid) to authenticated, service_role;

-- done means closed: the order's freight set to the same terms by any route closes its cards
create or replace function public.freight_terms_cards_close() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.freight_promises%rowtype;
begin
  for p in select q.* from public.freight_promises q join public.review_items r on r.id = q.review_item_id
            where q.order_id = new.id and q.status = 'review' and r.status = 'pending' loop
    if public.freight_promise_matches(p, new) then
      update public.freight_promises set status = 'matches' where id = p.id;
      update public.review_items set status = 'accepted', resolved_at = now(),
             resolution_note = 'VMS closed it: PO ' || coalesce(new.po_number, '(no PO)') || ' now says the same (' || public.freight_promise_text(p) || ').'
       where id = p.review_item_id and status = 'pending';
    end if;
  end loop;
  return null;
end $$;
revoke execute on function public.freight_terms_cards_close() from public, anon;
drop trigger if exists orders_freight_terms_cards on public.orders;
create trigger orders_freight_terms_cards after update of free_shipping, freight_terms, freight_cap_pct, free_over, freight_quote_amount on public.orders
  for each row execute function public.freight_terms_cards_close();

-- a WWD vendor's credit came in: the task waits for Edenred, not late
create or replace function public.credit_request_received(p_req uuid, p_link uuid, p_on date) returns void language plpgsql security definer set search_path = public as $$
declare r public.credit_requests%rowtype; v_wwd boolean; v_vn text; l public.vendor_links%rowtype;
begin
  select * into r from public.credit_requests where id = p_req and status = 'open';
  if r.id is null then return; end if;
  v_wwd := public.vendor_is_wwd(r.vendor_id);
  select name into v_vn from public.vendors where id = r.vendor_id;
  select * into l from public.vendor_links where id = p_link;
  update public.credit_requests set status = 'received', credit_link_id = p_link, received_on = p_on where id = p_req;
  update public.tasks set remind_at = null, remind_rule = null, reminded_at = null, reminder_seen_at = null,
         title = case when v_wwd then left('Waiting for WWD to post ' || coalesce(v_vn, 'the vendor') || ' credit'
                                           || coalesce(' ' || nullif(trim(l.doc_number), ''), '') || coalesce(' (' || public.money_text(abs(l.doc_total)) || ')', ''), 200)
                      else title end,
         due_date = case when v_wwd then null else due_date end,
         notes = 'The credit from ' || coalesce(v_vn, 'the vendor') || ' came in on ' || to_char(p_on, 'Mon FMDD') || ' and is in the vendor''s Credits folder, marked Received. '
                 || case when v_wwd then 'It is a WWD vendor: VMS is watching your Edenred uploads for it and will finish this task when it shows there. Nothing to do until then.'
                         else 'Not a WWD vendor: check it against the invoice, then mark this done.' end
   where id = r.task_id and done_at is null;
  delete from public.email_drafts where id = (select draft_id from public.tasks where id = r.task_id) and gmail_draft_id is null;
  update public.tasks set draft_id = null where id = r.task_id and draft_id is not null and not exists (select 1 from public.email_drafts d where d.id = public.tasks.draft_id);
end $$;
revoke execute on function public.credit_request_received(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.credit_request_received(uuid, uuid, date) to service_role;

-- ---- back-check ----------------------------------------------------------------------------------------------------
-- the readings with no order (their tasks closed at Dana's request, Nov 9) go; their emails and every email that gave
-- nothing are read again by the tighter reader (gmail-sync, 20 a minute)
delete from public.freight_promises where status = 'needs_order';
update public.emails e set freight_read_at = null
 where e.freight_read_at is not null and not exists (select 1 from public.freight_promises p where p.email_id = e.id);
