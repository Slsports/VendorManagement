-- 0363: the preview fills the wording for an order like the real email and writes nothing.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v uuid; o uuid; r record; n_req integer; n_send integer;
begin
  insert into public.vendors (organization_id, name) values (v_org, 'PARI 0363') returning id into v;
  insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, contact_type, roles, source) values (v_org, v, 'ted@pari0363.example', 'Ted Morton', 'orders', array['orders']::public.contact_type[], 'manual');
  insert into public.routing_letters (organization_id, version, storage_path, file_name, email_body) values (v_org, 1, v_org || '/routing/x0363.pdf', 'x.pdf', 'b');
  insert into public.orders (organization_id, vendor_id, status, po_number, source, free_shipping) values (v_org, v, 'awaiting_confirmation', 'P0363', 'manual', false) returning id into o;
  select count(*) into n_req from public.shipment_requests; select count(*) into n_send from public.routing_letter_sends;
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  select * into r from public.freight_email_preview(o, 'Freight for {po} ({vendor})', 'Hi {first_name}, [Click Here]({form_link}) or [click here]({receipt_link}).');
  perform set_config('request.jwt.claims', '', true);
  if r.subject <> 'Freight for P0363 (PARI 0363)' then raise exception 'subject: %', r.subject; end if;
  if r.body <> 'Hi Ted, [Click Here](https://vms.shaverlakesports.com/ship/new) or [click here](https://vms.shaverlakesports.com/r/preview).' then raise exception 'body: %', r.body; end if;
  if r.form_ready or not r.has_letter or r.to_emails <> array['ted@pari0363.example'] then raise exception 'flags: % % %', r.form_ready, r.has_letter, r.to_emails; end if;
  if (select count(*) from public.shipment_requests) <> n_req or (select count(*) from public.routing_letter_sends) <> n_send then raise exception 'the preview wrote something'; end if;
  raise exception 'ok-rollback';
exception when others then
  if sqlerrm <> 'ok-rollback' then raise; end if;
end $$;
