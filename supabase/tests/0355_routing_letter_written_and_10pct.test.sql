-- 0355: the shipment details email follows the 10% rule; an order that ships ends its request; "shipped without an approved
-- quote" leaves out freight known to be under 10%; a version can hold the letter's words.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v_vendor uuid; v_thread uuid; v_email uuid; v_order uuid; v_order2 uuid; r record; v_trevor uuid := '33333333-3333-3333-3333-333333333333';
begin
  update public.profiles set is_active = true, handles_logistics = true where id = v_trevor;
  insert into public.vendors (organization_id, name) values (v_org, 'TEST 10PCT 0355') returning id into v_vendor;
  insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at, vendor_id) values (v_org, 't0355', 'Confirmation', now(), v_vendor) returning id into v_thread;
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, from_name, to_emails, subject, received_at, body_text, vendor_id)
    values (v_org, v_thread, 'm0355-1', 'in', 'orders@v0355.example', 'Pat Orders', '{orders@shaverlakesports.com}', 'Confirmation', now() - interval '1 hour', 'Confirmed.', v_vendor) returning id into v_email;
  insert into public.orders (organization_id, vendor_id, status, po_number, source, free_shipping) values (v_org, v_vendor, 'awaiting_confirmation', 'T355', 'manual', false) returning id into v_order;
  insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, received_at, order_id, email_id) values (v_org, v_vendor, 'confirmation', 'Conf', 'x/0355.pdf', current_date, v_order, v_email);
  update public.orders set status = 'confirmed' where id = v_order;
  select * into r from public.shipment_requests where order_id = v_order;
  if r.id is null or r.kind <> 'details' then raise exception 'no details request'; end if;
  select * into r from public.shipment_request_email(r.id);
  if r.body not like '%Freight 10% or less of our merchandise cost:** ship it%' or r.body not like '%Over 10%:** fill out the freight form%' then raise exception 'email does not follow the 10%% rule: %', r.body; end if;
  -- the order ships on its own (under 10%): the request ends
  update public.orders set status = 'shipped' where id = v_order;
  if exists (select 1 from public.shipment_requests where order_id = v_order and status in ('ready', 'sent', 'opened')) then raise exception 'request still open after shipping'; end if;

  -- shipped without a quote: listed at 15%, not at 5% (the list is read as a member of the organization)
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  insert into public.orders (organization_id, vendor_id, status, po_number, source, free_shipping, order_date, est_cost, freight_cost) values (v_org, v_vendor, 'shipped', 'T355B', 'manual', false, '2026-11-01', 1000, 150) returning id into v_order2;
  if not exists (select 1 from public.freight_unapproved_shipments(v_org) where order_id = v_order2) then raise exception '15%% freight not listed'; end if;
  update public.orders set freight_cost = 50 where id = v_order2;
  if exists (select 1 from public.freight_unapproved_shipments(v_org) where order_id = v_order2) then raise exception '5%% freight listed'; end if;
  update public.orders set freight_cost = null where id = v_order2;
  if not exists (select 1 from public.freight_unapproved_shipments(v_org) where order_id = v_order2) then raise exception 'unknown freight not listed'; end if;

  perform set_config('request.jwt.claims', '', true);
  -- a version holds the letter's words
  insert into public.routing_letters (organization_id, version, storage_path, file_name, email_body, content)
    values (v_org, 9355, v_org || '/routing/x.pdf', 'x.pdf', 'b', '{"title":"T","sections":[]}'::jsonb);
  if (select content->>'title' from public.routing_letters where version = 9355) <> 'T' then raise exception 'content not kept'; end if;
  raise exception 'ok-rollback';
exception when others then
  if sqlerrm <> 'ok-rollback' then raise; end if;
end $$;
