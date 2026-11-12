-- 0360 — Half freight and capped freight (Dana, Nov 12): "I want to know how much the freight will be if Im paying half.
-- And if its still too high I want to shop it first. If the freight is capped, it would depend on what it is capped at."
-- … "the vendor only requires a copy of our invoice from the freight co to credit us for half the freight" … "Capped over
-- 10% needs a quote" … "on the half freight that order will need more processes to follow the freight invoice, get it to
-- the vendor and check for our credit" (Stansport PO STANSPORT91226: their quote $480.18, Oak Harbor through Pinnacle
-- $281.47; Dana sent the Priority One bill Oct 7, credit T1709229 Oct 8) … "Trevor sends it, go".
--   • Capped at 10% or less: the check email asks them to confirm the cap and says they can ship without a quote.
--     Capped over 10%: as before, the cap, the form and their quote, held until we OK it.
--   • Half freight: when a freight bill line is tied to a half-freight order, Trevor gets "Ask … for half the freight" with
--     the email ready in his Drafts, the bill attached, asking for a credit for half (the amount named). Once he sends it,
--     the credit is tracked like any credit we ask for (gmail-sync reads our sent mail), until it comes in.
--   • The freight quote page shows what we pay: our half, or the most under the cap, and each as a share of the order.
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
  elsif o.freight_cap_pct is not null and o.freight_cap_pct <= 10 then
    -- a cap of 10% or less (Dana, Nov 12): our share can never pass 10%, so no quote is needed; they confirm the cap and ship
    v_subj := 'Freight on our PO ' || v_po || coalesce(' (your order ' || v_their || ')', '');
    v_body := v_hi || 'Thank you for the confirmation. Our order was placed with the understanding that freight would be capped at ' || v_cap || ' of the order, but we didn''t see that noted on the confirmation. Could you reply and confirm that freight on this order, and on any backorders that may arrive, will not exceed ' || v_cap || '?' || E'\n\n'
      || 'With that cap you can ship it without sending us a quote. Our freight routing instructions are attached.' || E'\n\nThanks,';
  else
    -- capped over 10% (Dana, Nov 12: "Capped over 10% needs a quote")
    v_subj := 'Freight on our PO ' || v_po || coalesce(' (your order ' || v_their || ')', '');
    v_body := v_hi || 'Thank you for the confirmation. Our order was placed with the understanding that freight would be capped at ' || v_cap || ' of the order, but we didn''t see that noted on the confirmation. Could you reply and confirm that freight on this order, and on any backorders that may arrive, will not exceed ' || v_cap || '?' || E'\n\n'
      || 'Please also click the link below to enter the shipment details and your freight quote, and hold the shipment until we have confirmed the freight.' || E'\n\n' || v_link || E'\n\nThanks,';
  end if;
  return query select v_subj, v_body, s.to_emails, s.cc_emails, s.reply_to_email_id, (select e.thread_id from public.emails e where e.id = s.reply_to_email_id), s.send_as, s.vendor_id, s.order_id,
                      exists (select 1 from public.routing_letters where organization_id = s.organization_id);
end $$;
revoke execute on function public.shipment_request_email(uuid) from public, anon;
grant execute on function public.shipment_request_email(uuid) to authenticated, service_role;

/** A freight bill line on a half-freight order: the email asking the vendor for half, with the bill, for Trevor to send. */
create or replace function public.half_freight_credit_ask(p_line uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare l public.freight_bill_lines%rowtype; b public.freight_bills%rowtype; o public.orders%rowtype; v_name text; r record; v_who uuid;
        v_half numeric; v_total numeric; v_po text; v_carrier text; v_draft uuid; v_task uuid; v_first text;
begin
  select * into l from public.freight_bill_lines where id = p_line;
  if l.id is null or l.order_id is null then return null; end if;
  select * into o from public.orders where id = l.order_id;
  if o.id is null or o.freight_terms is distinct from 'half' then return null; end if;
  if exists (select 1 from public.tasks where organization_id = o.organization_id and auto_key = 'halfcredit:' || l.id) then return null; end if;
  select * into b from public.freight_bills where id = l.bill_id;
  v_total := coalesce(l.amount, 0) + coalesce(l.fee_amount, 0);
  if v_total <= 0 then return null; end if;
  v_half := round(v_total / 2, 2);
  select name into v_name from public.vendors where id = o.vendor_id;
  select c.name into v_carrier from public.carriers c where c.id = b.carrier_id;
  v_po := coalesce('PO ' || nullif(trim(o.po_number), ''), 'our order');
  v_who := coalesce(public.freight_assignee(o.organization_id), public.org_admin(o.organization_id));
  if v_who is null then return null; end if;
  select * into r from public.shipment_request_recipients(o.id);
  select split_part(nullif(trim(coalesce(e.from_name, '')), ''), ' ', 1) into v_first from public.emails e where e.id = r.reply_to;
  insert into public.email_drafts (organization_id, owner_id, created_by, to_emails, cc_emails, subject, body, reply_to_email_id, thread_id, vendor_id, order_id, files, note)
  values (o.organization_id, v_who, v_who, coalesce(r.to_emails, '{}'), coalesce(r.cc_emails, '{}'),
          'Half freight credit for our ' || v_po,
          'Hi ' || coalesce(nullif(v_first, ''), 'there') || E',\n\n'
            || v_po || ' shipped under our half-freight agreement. The freight bill is attached: ' || to_char(v_total, 'FM$999,999,990.00')
            || coalesce(' (' || v_carrier || coalesce(', invoice ' || nullif(b.invoice_number, ''), '') || ')', '') || '.' || E'\n\n'
            || 'Please issue a credit for half, ' || to_char(v_half, 'FM$999,999,990.00') || ', and send us a copy of the credit.' || E'\n\nThanks,',
          r.reply_to, (select thread_id from public.emails where id = r.reply_to), o.vendor_id, o.id,
          case when b.storage_path is not null then jsonb_build_array(jsonb_build_object('name', coalesce(b.file_name, 'Freight bill.pdf'), 'mime', 'application/pdf', 'path', b.storage_path)) else '[]'::jsonb end,
          'Half freight credit for ' || coalesce(v_name, 'the vendor') || ', ' || v_po || case when b.storage_path is null then ' (attach the freight bill: VMS has no PDF of it)' else '' end)
  returning id into v_draft;
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, vendor_id, order_id, draft_id, auto_key)
  values (o.organization_id, left('Ask ' || coalesce(v_name, 'the vendor') || ' for half the freight: ' || v_po || ' (' || to_char(v_half, 'FM$999,999,990.00') || ')', 200),
          'Half-freight order: the vendor credits half once they have our freight bill. The email is ready in your Drafts (Go to it) with the bill attached'
            || case when b.storage_path is null then ' (no PDF on file: attach it first)' else '' end
            || '. Once it is sent, VMS tracks the credit until it comes in.',
          public.next_business_day(now()), now(), v_who, v_who, o.vendor_id, o.id, v_draft, 'halfcredit:' || l.id)
  on conflict (organization_id, auto_key) where auto_key is not null do nothing
  returning id into v_task;
  return v_task;
end $$;
revoke execute on function public.half_freight_credit_ask(uuid) from public, anon, authenticated;

create or replace function public.freight_bill_lines_half_credit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.order_id is not null and (tg_op = 'INSERT' or new.order_id is distinct from old.order_id) then
    perform public.half_freight_credit_ask(new.id);
  end if;
  return null;
end $$;
revoke execute on function public.freight_bill_lines_half_credit() from public, anon, authenticated;
drop trigger if exists freight_bill_lines_half_credit on public.freight_bill_lines;
create trigger freight_bill_lines_half_credit after insert or update of order_id on public.freight_bill_lines
  for each row execute function public.freight_bill_lines_half_credit();
