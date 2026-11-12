-- 0356 — "10% or less everywhere" (Dana, Nov 12). Her red note on the vendor form says "IF FREIGHT IS FREE OR YOUR RATE
-- QUOTE CAME IN AT 10% OR LESS YOU ARE AUTHORIZED TO SHIP"; the shipment details email, its follow-up, the freight list
-- and the routing email said "under 10%". Now all say 10% or less ships, over 10% needs the quote and the form.
set local lock_timeout = '5s';

create or replace function public.shipment_request_email(p_req uuid)
returns table (subject text, body text, to_emails text[], cc_emails text[], reply_to_email_id uuid, thread_id uuid, send_as uuid, vendor_id uuid, order_id uuid, attach_routing_letter boolean)
language plpgsql stable security definer set search_path = public as $$
declare s public.shipment_requests%rowtype; o public.orders%rowtype; v public.vendors%rowtype; v_first text; v_po text; v_their text; v_link text; v_hi text; v_subj text; v_body text; v_cap text;
begin
  select * into s from public.shipment_requests where id = p_req;
  if s.id is null then return; end if;
  select * into o from public.orders where id = s.order_id;
  select * into v from public.vendors where id = s.vendor_id;
  v_po := coalesce(nullif(trim(o.po_number), ''), '');
  select nullif(trim(l.doc_number), '') into v_their from public.vendor_links l where l.order_id = o.id and l.kind = 'confirmation' order by l.created_at desc limit 1;
  select split_part(nullif(trim(coalesce(e.from_name, ve.contact_name, '')), ''), ' ', 1) into v_first
    from (select 1) x left join public.emails e on e.id = s.reply_to_email_id left join public.vendor_emails ve on ve.vendor_id = s.vendor_id and lower(ve.email) = s.to_emails[1] and ve.former_at is null limit 1;
  v_hi := 'Hi ' || coalesce(nullif(v_first, ''), 'there') || E',\n\n';
  v_link := 'https://vms.shaverlakesports.com/ship/' || s.token;
  v_cap := case when o.freight_cap_pct is not null then trim(trailing '.' from trim(trailing '0' from o.freight_cap_pct::text)) || '%' else 'the agreed percentage' end;
  if s.kind = 'details' then
    v_subj := 'Shipment details and freight quote for our PO ' || v_po || coalesce(' (your order ' || v_their || ')', '');
    v_body := v_hi || 'Thank you for the confirmation. Before this order ships, please check the freight cost:' || E'\n\n'
      || '- 10% or less of the merchandise cost: go ahead and ship it with your carrier and add the freight to the invoice.' || E'\n'
      || '- Over 10%: please hold the shipment and click the link below to enter the shipment details and your freight quote. It takes about two minutes. We will schedule the shipment and let you know when it will be picked up.' || E'\n\n'
      || v_link || E'\n\n'
      || 'If you are paying the full freight, including backorders, simply reply and confirm that this order and any backorders will ship free to us.' || E'\n\n'
      || 'Our freight routing instructions are attached, including how to pack boxes for UPS.' || E'\n\nThanks,';
  elsif s.kind = 'free_check' then
    v_subj := 'Freight on our PO ' || v_po || coalesce(' (your order ' || v_their || ')', '');
    v_body := v_hi || 'Thank you for the confirmation. Our order was placed with the understanding we would receive free shipping, but we didn''t see that noted on the confirmation. Could you reply and confirm that this order, and any backorders that may arrive, will ship free to us?' || E'\n\nThanks,';
  elsif s.kind = 'half_check' then
    v_subj := 'Freight on our PO ' || v_po || coalesce(' (your order ' || v_their || ')', '');
    v_body := v_hi || 'Thank you for the confirmation. Our order was placed with the understanding that you would cover half of the freight, but we didn''t see that noted on the confirmation. Could you reply and confirm that this order, and any backorders that may arrive, will ship with half the freight covered by you?' || E'\n\n'
      || 'Please also click the link below to enter the shipment details and your freight quote, so we can see our share before it ships. Please hold the shipment until we have confirmed the freight.' || E'\n\n' || v_link || E'\n\nThanks,';
  else
    v_subj := 'Freight on our PO ' || v_po || coalesce(' (your order ' || v_their || ')', '');
    v_body := v_hi || 'Thank you for the confirmation. Our order was placed with the understanding that freight would be capped at ' || v_cap || ' of the order, but we didn''t see that noted on the confirmation. Could you reply and confirm that freight on this order, and on any backorders that may arrive, will not exceed ' || v_cap || '?' || E'\n\n'
      || 'Please also click the link below to enter the shipment details and your freight quote. Please hold the shipment until we have confirmed the freight.' || E'\n\n' || v_link || E'\n\nThanks,';
  end if;
  return query select v_subj, v_body, s.to_emails, s.cc_emails, s.reply_to_email_id, (select e.thread_id from public.emails e where e.id = s.reply_to_email_id), s.send_as, s.vendor_id, s.order_id,
                      exists (select 1 from public.routing_letters where organization_id = s.organization_id);
end $$;
revoke execute on function public.shipment_request_email(uuid) from public, anon;
grant execute on function public.shipment_request_email(uuid) to authenticated, service_role;

create or replace function public.freight_unapproved_shipments(p_org uuid)
returns table (order_id uuid, vendor_id uuid, vendor_name text, po_number text, order_date date, status text, has_quote boolean)
language sql stable security definer set search_path = public as $$
  select o.id, o.vendor_id, v.name, o.po_number, o.order_date, o.status::text,
         exists (select 1 from public.freight_quotes q where q.order_id = o.id)
    from public.orders o join public.vendors v on v.id = o.vendor_id
   where o.organization_id = p_org and public.user_in_org(p_org)
     and o.status in ('shipped', 'received')
     and coalesce(o.order_date, o.created_at::date) >= date '2026-10-14'
     and o.free_shipping is not true and not v.web_orders
     and not exists (select 1 from public.freight_quotes q where q.order_id = o.id and q.status = 'approved')
     -- the 10% rule (Dana, Nov 12: "10% or less everywhere"): freight known and 10% or less of the merchandise needed no quote
     and not (o.freight_cost is not null and o.freight_cost <= 0.10 * coalesce(
           nullif((select sum(l.extended) from public.order_lines l where l.order_id = o.id), 0), o.final_cost, o.est_cost, 0))
   order by o.order_date desc nulls last
$$;
revoke execute on function public.freight_unapproved_shipments(uuid) from public, anon;
grant execute on function public.freight_unapproved_shipments(uuid) to authenticated, service_role;

create or replace function public.shipment_request_followups(p_org uuid) returns integer language plpgsql security definer set search_path = public as $$
declare s record; o public.orders%rowtype; v_name text; v_first text; v_task uuid; v_draft uuid; v_last uuid; v_po text; v_subj text; n integer := 0; m public.emails%rowtype;
begin
  for s in select * from public.shipment_requests where organization_id = p_org and status in ('sent', 'opened') and followup_due_at <= now() and followup_task_id is null loop
    select * into o from public.orders where id = s.order_id;
    select name into v_name from public.vendors where id = s.vendor_id;
    select * into m from public.emails where id = s.sent_email_id;
    v_po := coalesce(nullif(trim(o.po_number), ''), '');
    select split_part(full_name, ' ', 1) into v_first from public.profiles where id = s.send_as;
    select id into v_last from public.emails where thread_id = s.thread_id and direction <> 'internal' order by received_at desc limit 1;
    v_subj := case when m.subject ilike 'Re:%' then m.subject else 'Re: ' || coalesce(m.subject, 'Shipment details for PO ' || v_po) end;
    insert into public.email_drafts (organization_id, owner_id, created_by, to_emails, cc_emails, subject, body, thread_id, reply_to_email_id, vendor_id, order_id, note)
    values (s.organization_id, s.send_as, s.send_as, s.to_emails, s.cc_emails, v_subj,
            'Hi,' || E'\n\n' || 'Following up on PO ' || v_po || '. If the freight is 10% or less of the merchandise cost, please go ahead and ship it and add the freight to the invoice. If it is over 10%, please fill in the short form here when you have a minute: https://vms.shaverlakesports.com/ship/' || s.token
              || E'. It takes about two minutes, and we will schedule the shipment.\n\nThanks,',
            s.thread_id, coalesce(v_last, s.sent_email_id), s.vendor_id, s.order_id,
            'Follow-up on the shipment details from ' || coalesce(v_name, 'the vendor') || ' (VMS made this draft after 3 business days with no answer; send it or change it)')
    returning id into v_draft;
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, vendor_id, order_id, thread_id, draft_id, auto_key)
    values (s.organization_id, left('No shipment details yet: ' || coalesce(v_name, 'the vendor') || ', PO ' || v_po, 200),
            'VMS emailed them on ' || to_char(s.sent_at at time zone 'America/Los_Angeles', 'Mon FMDD') || ' and nothing has come back after 3 business days. A follow-up email is ready in your Drafts (Go to it): send it as is or change it. This task finishes itself when the form or a reply with the details comes in, or the order ships.',
            current_date, now(), s.send_as, s.send_as, s.vendor_id, s.order_id, s.thread_id, v_draft, 'shipreq:' || s.id)
    on conflict (organization_id, auto_key) where auto_key is not null do nothing returning id into v_task;
    update public.shipment_requests set followup_task_id = v_task, followup_draft_id = v_draft where id = s.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.shipment_request_followups(uuid) from public, anon, authenticated;
grant execute on function public.shipment_request_followups(uuid) to service_role;

create or replace function public.orders_shipment_request_end() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('shipped', 'cancelled', 'received', 'entered', 'ready_to_pay', 'paid') and old.status is distinct from new.status then
    update public.shipment_requests set status = 'cancelled', followup_due_at = null where order_id = new.id and status in ('ready', 'sent', 'opened');
    update public.tasks set done_at = now(), closed_how = 'vms', done_note = 'The order is ' || new.status || '; no shipment details needed now (at 10% or less a vendor may ship on its own).' where order_id = new.id and done_at is null and (auto_key like 'shipreq:%' or auto_key like 'shipreq_noemail:%');
  end if;
  return null;
end $$;
drop trigger if exists orders_shipment_request_end on public.orders;
create trigger orders_shipment_request_end after update of status on public.orders for each row execute function public.orders_shipment_request_end();

-- the routing letter's email on every version
update public.routing_letters set email_body = replace(replace(email_body,
  'if the freight on an order is under 10% of the merchandise cost, go ahead and ship it', 'if the freight on an order is 10% or less of the merchandise cost, go ahead and ship it'),
  'If it is 10% or more, please send us your freight quote', 'If it is over 10%, please send us your freight quote')
 where email_body like '%under 10% of the merchandise cost%' or email_body like '%If it is 10% or more%';
