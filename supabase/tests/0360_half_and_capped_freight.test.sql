-- 0360: capped at 10% or less ships without a quote; over 10% needs the form; a freight bill line on a half-freight order
-- makes Trevor's email asking for half, with the bill attached.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v uuid; th uuid; e uuid; o uuid; o2 uuid; o3 uuid; r record; b uuid; t record; d record; v_trevor uuid := '33333333-3333-3333-3333-333333333333';
begin
  update public.profiles set is_active = true, handles_logistics = true where id = v_trevor;
  insert into public.vendors (organization_id, name) values (v_org, 'STANS 0360') returning id into v;
  insert into public.email_threads (organization_id, gmail_thread_id, subject, last_message_at, vendor_id) values (v_org, 't0360', 'Conf', now(), v) returning id into th;
  insert into public.emails (organization_id, thread_id, gmail_id, direction, from_email, from_name, to_emails, subject, received_at, body_text, vendor_id)
    values (v_org, th, 'm0360-1', 'in', 'jean@stans0360.example', 'Jean Clark', '{orders@shaverlakesports.com}', 'Conf', now() - interval '1 day', 'Confirmed.', v) returning id into e;
  -- capped 8%: no quote needed
  insert into public.orders (organization_id, vendor_id, status, po_number, source, free_shipping, freight_terms, freight_cap_pct) values (v_org, v, 'awaiting_confirmation', 'C0360A', 'manual', false, 'capped', 8) returning id into o;
  insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, received_at, order_id, email_id) values (v_org, v, 'confirmation', 'Conf', 'x/0360a.pdf', current_date, o, e);
  update public.orders set status = 'confirmed' where id = o;
  select * into r from public.shipment_request_email((select id from public.shipment_requests where order_id = o));
  if r.body not like '%Cap of 10% or less of our merchandise cost:** reply to this email to confirm the cap and ship it%' then raise exception 'cap 8%%: wrong email: %', r.body; end if;
  -- capped 15%: quote and form
  insert into public.orders (organization_id, vendor_id, status, po_number, source, free_shipping, freight_terms, freight_cap_pct) values (v_org, v, 'awaiting_confirmation', 'C0360B', 'manual', false, 'capped', 15) returning id into o2;
  insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, received_at, order_id, email_id) values (v_org, v, 'confirmation', 'Conf B', 'x/0360b.pdf', current_date, o2, e);
  update public.orders set status = 'confirmed' where id = o2;
  select * into r from public.shipment_request_email((select id from public.shipment_requests where order_id = o2));
  if r.body not like '%/ship/%' or r.body not like '%Cap over 10%:** fill out the freight form%' then raise exception 'cap 15%%: no form'; end if;

  -- half freight: the bill line on the order → Trevor's email asking for half, bill attached
  insert into public.orders (organization_id, vendor_id, status, po_number, source, free_shipping, freight_terms) values (v_org, v, 'shipped', 'H0360', 'manual', false, 'half') returning id into o3;
  insert into public.freight_bills (organization_id, invoice_number, total, storage_path, file_name) values (v_org, 'P1-0360', 281.47, v_org || '/freight/x-0360.pdf', 'Priority1Invoice0360.pdf') returning id into b;
  insert into public.freight_bill_lines (organization_id, bill_id, amount, order_id) values (v_org, b, 281.47, o3);
  select * into t from public.tasks where auto_key like 'halfcredit:%' and order_id = o3;
  if t.id is null or t.assigned_to <> v_trevor or t.title not like '%$140.74%' then raise exception 'no half-freight task for Trevor: %', t.title; end if;
  select * into d from public.email_drafts where id = t.draft_id;
  if d.body not like '%credit for half, $140.74%' or jsonb_array_length(d.files) <> 1 or d.files->0->>'path' not like '%/freight/%' then raise exception 'draft wrong'; end if;
  raise exception 'ok-rollback';
exception when others then
  if sqlerrm <> 'ok-rollback' then raise; end if;
end $$;
