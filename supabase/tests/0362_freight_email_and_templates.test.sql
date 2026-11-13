-- 0362: a confirmed order's request uses the Freight email template with the order's form link and the routing letter's
-- "click here"; the one-click opener makes a draft for any order; sending it stamps the request and the letter.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v uuid; th uuid; e uuid; o uuid; o2 uuid; r record; s record; d uuid; v_trevor uuid := '33333333-3333-3333-3333-333333333333'; me uuid := '11111111-1111-1111-1111-111111111111'; sent uuid;
begin
  update public.profiles set is_active = true, handles_logistics = true where id = v_trevor;
  insert into public.vendors (organization_id, name) values (v_org, 'PARI 0362') returning id into v;
  insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, contact_type, roles, source) values (v_org, v, 'ted@pari0362.example', 'Ted Morton', 'orders', array['orders']::public.contact_type[], 'manual');
  insert into public.routing_letters (organization_id, version, storage_path, file_name, email_body) values (v_org, 1, v_org || '/routing/x.pdf', 'x.pdf', 'b');
  insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at, vendor_id) values (v_org, 't0362', 'Conf', now(), v) returning id into th;
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, from_name, to_emails, subject, received_at, body_text, vendor_id)
    values (v_org, th, 'm0362-1', 'in', 'ted@pari0362.example', 'Ted Morton', '{orders@shaverlakesports.com}', 'Conf', now() - interval '1 day', 'Confirmed.', v) returning id into e;
  insert into public.orders (organization_id, vendor_id, status, po_number, source, free_shipping, freight_terms) values (v_org, v, 'awaiting_confirmation', 'P0362', 'manual', false, 'half') returning id into o;
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, body_text, vendor_id, order_id) values (v_org, th, 'ord-0362-1', 'out', 'orders@shaverlakesports.com', '{ted@pari0362.example}', 'Our order', now() - interval '3 days', 'Our order.', v, o); -- 0365: the freight email goes to whoever we ordered with
  insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, received_at, order_id, email_id) values (v_org, v, 'confirmation', 'Conf', 'x/0362.pdf', current_date, o, e);
  update public.orders set status = 'confirmed' where id = o;
  select * into s from public.shipment_requests where order_id = o;
  if s.kind <> 'details' then raise exception 'not the one Freight email: %', s.kind; end if;
  select * into r from public.shipment_request_email(s.id);
  if r.subject <> 'Freight for our PO P0362 – Shaver Lake Sports' then raise exception 'subject: %', r.subject; end if;
  if r.body not like 'Hi Ted,%' or r.body not like '%[Click Here](https://vms.shaverlakesports.com/ship/' || s.token || ')%' or r.body not like '%[click here](https://vms.shaverlakesports.com/r/%' or r.body like '%{%' then raise exception 'body: %', r.body; end if;
  if not r.attach_routing_letter then raise exception 'letter not attached'; end if;
  select * into s from public.shipment_requests where order_id = o;
  if s.routing_send_id is null then raise exception 'no routing letter send'; end if;

  -- one click on an order that is only Placed: a draft
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  insert into public.orders (organization_id, vendor_id, status, po_number, source, free_shipping) values (v_org, v, 'awaiting_confirmation', 'P0362B', 'manual', false) returning id into o2;
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, body_text, vendor_id, order_id) values (v_org, th, 'ord-0362-2', 'out', 'orders@shaverlakesports.com', '{ted@pari0362.example}', 'Our order', now() - interval '3 days', 'Our order.', v, o2); -- 0365: the freight email goes to whoever we ordered with
  d := public.freight_email_open(o2);
  if d is null or not exists (select 1 from public.email_drafts where id = d and order_id = o2 and subject = 'Freight for our PO P0362B – Shaver Lake Sports') then raise exception 'no draft from the button'; end if;
  if public.freight_email_open(o2) <> d then raise exception 'a second draft instead of the same one'; end if;
  perform set_config('request.jwt.claims', '', true);
  -- sending it stamps the request and the routing letter
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, body_text, vendor_id)
    values (v_org, th, 'm0362-2', 'out', 'orders@shaverlakesports.com', '{ted@pari0362.example}', 'Freight for our PO P0362B', now(), 'x', v) returning id into sent;
  perform public.mail_command_sent(d, sent, me);
  select * into s from public.shipment_requests where order_id = o2;
  if s.status <> 'sent' or s.followup_due_at is null then raise exception 'request not stamped: %', s.status; end if;
  if (select sent_at from public.routing_letter_sends where id = s.routing_send_id) is null then raise exception 'routing letter not marked sent'; end if;
  raise exception 'ok-rollback';
exception when others then
  if sqlerrm <> 'ok-rollback' then raise; end if;
end $$;
