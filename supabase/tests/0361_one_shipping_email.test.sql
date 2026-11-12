-- 0361: a confirmed order gives Trevor the Ship and receive task and the shipment details request, and no placeholder
-- "Shipping instructions" email.
do $$
declare v_org uuid := '00000000-0000-0000-0000-000000000001'; v uuid; o uuid; v_trevor uuid := '33333333-3333-3333-3333-333333333333';
begin
  update public.profiles set is_active = true, handles_logistics = true where id = v_trevor;
  perform set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
  insert into public.vendors (organization_id, name) values (v_org, 'ONE SHIP 0361') returning id into v;
  insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, contact_type, roles, source) values (v_org, v, 'ship@one0361.example', 'Sam', 'shipping', array['shipping']::public.contact_type[], 'manual');
  insert into public.orders (organization_id, vendor_id, status, po_number, source, free_shipping) values (v_org, v, 'awaiting_confirmation', 'S0361', 'manual', false) returning id into o;
  update public.orders set status = 'confirmed' where id = o;
  if not exists (select 1 from public.tasks where auto_key = 'ship:' || o) then raise exception 'no Ship and receive task'; end if;
  if exists (select 1 from public.email_drafts where order_id = o and subject like 'Shipping instructions%') then raise exception 'placeholder email still made'; end if;
  if not exists (select 1 from public.shipment_requests where order_id = o) then raise exception 'no shipment details request'; end if;
  perform set_config('request.jwt.claims', '', true);
  raise exception 'ok-rollback';
exception when others then
  if sqlerrm <> 'ok-rollback' then raise; end if;
end $$;
