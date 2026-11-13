-- 0364: with no shipping, orders or rep-group contact, the Freight email goes to the vendor's own main rep, never the
-- alternate or a former contact.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v uuid; o uuid; r record; c_alt uuid;
begin
  insert into public.vendors (organization_id, name) values (v_org, 'PARI 0364') returning id into v;
  insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, contact_type, roles, source, former_at) values (v_org, v, 'old@pari0364.example', 'Old Rep', 'rep', array['rep']::public.contact_type[], 'manual', now());
  insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, contact_type, roles, source, last_vendor_mail_at) values (v_org, v, 'alt@pari0364.example', 'Alt Rep', 'rep', array['rep']::public.contact_type[], 'manual', now()) returning id into c_alt;
  insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, contact_type, roles, source, last_vendor_mail_at) values (v_org, v, 'ted@pari0364.example', 'Ted Morton', 'rep', array['rep']::public.contact_type[], 'manual', now() - interval '1 day');
  update public.vendors set alternate_rep_contact_id = c_alt where id = v;
  insert into public.orders (organization_id, vendor_id, status, po_number, source, free_shipping) values (v_org, v, 'awaiting_confirmation', 'P0364', 'manual', false) returning id into o;
  select * into r from public.shipment_request_recipients(o);
  if r.to_emails <> array['ted@pari0364.example'] then raise exception 'to: %', r.to_emails; end if;
  raise exception 'ok-rollback';
exception when others then
  if sqlerrm <> 'ok-rollback' then raise; end if;
end $$;
