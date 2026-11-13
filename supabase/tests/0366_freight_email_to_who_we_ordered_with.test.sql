-- 0366: the Freight email goes to whoever we placed the order with; their shipping people only when they wrote about it.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v uuid; th uuid; o uuid; o2 uuid; o3 uuid; r record; c_main uuid;
begin
  insert into public.vendors (organization_id, name, email) values (v_org, 'VND 0366', 'info@vnd0366.example') returning id into v;
  insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, contact_type, roles, source) values (v_org, v, 'ship@vnd0366.example', 'Sam Ship', 'shipping', array['shipping']::public.contact_type[], 'manual');
  insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, contact_type, roles, source) values (v_org, v, 'rep@vnd0366.example', 'Rita Rep', 'rep', array['rep']::public.contact_type[], 'manual') returning id into c_main;
  update public.vendors set assigned_rep_contact_id = c_main where id = v;
  insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at, vendor_id) values (v_org, 't0366', 'Order', now(), v) returning id into th;
  insert into public.orders (organization_id, vendor_id, status, po_number, source, free_shipping) values (v_org, v, 'awaiting_confirmation', 'PO-0366A', 'manual', false) returning id into o;
  -- sent to Marcy, no answer, re-sent to Bob
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, body_text, vendor_id, order_id)
    values (v_org, th, 'm0366-1', 'out', 'orders@shaverlakesports.com', '{marcy@vnd0366.example,trevor@shaverlakesports.com}', 'Order PO-0366A', now() - interval '3 days', 'x', v, o),
           (v_org, th, 'm0366-2', 'out', 'orders@shaverlakesports.com', '{bob@vnd0366.example}', 'Fwd: Order PO-0366A', now() - interval '1 day', 'x', v, o);
  select * into r from public.shipment_request_recipients(o);
  if r.to_emails <> array['bob@vnd0366.example'] or cardinality(r.cc_emails) <> 0 then raise exception 'placed-with: % cc %', r.to_emails, r.cc_emails; end if;
  -- their shipping person wrote to us about this order: copied
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, body_text, vendor_id)
    values (v_org, th, 'm0366-3', 'in', 'ship@vnd0366.example', '{orders@shaverlakesports.com}', 'Re: Order PO-0366A', now(), 'Ships Friday', v);
  select * into r from public.shipment_request_recipients(o);
  if r.cc_emails <> array['ship@vnd0366.example'] then raise exception 'shipping cc: %', r.cc_emails; end if;
  -- an order from the sheets: our email naming the PO
  insert into public.orders (organization_id, vendor_id, status, po_number, source, free_shipping) values (v_org, v, 'awaiting_confirmation', 'PO-0366B', 'order_guide', false) returning id into o2;
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, to_emails, subject, received_at, body_text, vendor_id)
    values (v_org, th, 'm0366-4', 'out', 'orders@shaverlakesports.com', '{carl@vnd0366.example}', 'Our order PO-0366B', now(), 'x', v);
  select * into r from public.shipment_request_recipients(o2);
  if r.to_emails <> array['carl@vnd0366.example'] then raise exception 'by PO: %', r.to_emails; end if;
  -- nothing in mail: our main rep
  insert into public.orders (organization_id, vendor_id, status, po_number, source, free_shipping) values (v_org, v, 'awaiting_confirmation', 'PO-0366C', 'order_guide', false) returning id into o3;
  select * into r from public.shipment_request_recipients(o3);
  if r.to_emails <> array['rep@vnd0366.example'] then raise exception 'main rep: %', r.to_emails; end if;
  if public.freight_first_name(v, 'rep@vnd0366.example', null) <> 'Rita' then raise exception 'first name'; end if;
  raise exception 'ok-rollback';
exception when others then
  if sqlerrm <> 'ok-rollback' then raise; end if;
end $$;
