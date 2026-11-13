-- 0384 — Sandboxx Group is Reef Sport's rep group, its owner Tom Dawson our main rep (Dana, Nov 13: "Reef Sport is a line of
-- sunscreen and sun skin care products that we buy from the rep group Sandboxx group … I work directly with the owner of
-- Sandbox and order via email with him and pay via bill.com" … "Tom Dawson is the owner").
--   • Rep group SANDBOXX GROUP with Tom Dawson (Owner, tomdawson@sandboxxgroup.com, both phones), marked Main rep on
--     REEF SPORT SUNCARE; his contact cards filed under the vendor are moved there (misfiled: deleted, not kept as former).
--   • Jeff Turner (Turner Group Reps) stays on the vendor as he is.
set local lock_timeout = '5s';

do $$
declare v_keep constant uuid := '10bd730a-d8b9-46e1-9f43-a9ae06abad5b'; v_org uuid; v_rg uuid; v_c uuid; t record;
begin
  select organization_id into v_org from public.vendors where id = v_keep;
  if v_org is null then return; end if;
  select * into t from public.vendor_emails where lower(email) = 'tomdawson@sandboxxgroup.com' order by (vendor_id = v_keep) desc, updated_at desc limit 1;
  select id into v_rg from public.rep_groups where organization_id = v_org and upper(name) = 'SANDBOXX GROUP';
  if v_rg is null then
    insert into public.rep_groups (organization_id, name, contact_name, email, phone, notes)
    values (v_org, 'SANDBOXX GROUP', 'Tom Dawson', 'tomdawson@sandboxxgroup.com', coalesce(t.phone, '909-790-0460'),
            'Reef Sport''s rep group. Dana orders by email with the owner, Tom Dawson, and pays through Bill.com (Nov 13, 2026).')
    returning id into v_rg;
  end if;
  select id into v_c from public.rep_group_contacts where rep_group_id = v_rg and lower(email) = 'tomdawson@sandboxxgroup.com';
  if v_c is null then
    insert into public.rep_group_contacts (organization_id, rep_group_id, name, title, email, phone, phones, notes, first_mail_at, last_mail_at, learned_email_id)
    values (v_org, v_rg, 'Tom Dawson', 'Owner', 'tomdawson@sandboxxgroup.com', coalesce(t.phone, '909-790-0460'),
            coalesce(t.phones, '[{"type":"work","number":"909-790-0460"},{"type":"cell","number":"909-215-7917"}]'::jsonb),
            'Owner of Sandboxx Group (Dana, Nov 13, 2026).', t.first_mail_at, t.last_mail_at, t.learned_email_id)
    returning id into v_c;
  end if;
  update public.vendors set rep_group_id = v_rg, assigned_rep_group_contact_id = v_c,
         assigned_rep_contact_id = case when assigned_rep_contact_id in (select id from public.vendor_emails where lower(email) = 'tomdawson@sandboxxgroup.com') then null else assigned_rep_contact_id end
   where id = v_keep;
  -- his cards filed under the vendor (and the merged Sandboxx record) were in the wrong place: moved, so deleted
  update public.vendors set alternate_rep_contact_id = null where alternate_rep_contact_id in (select id from public.vendor_emails where lower(email) = 'tomdawson@sandboxxgroup.com');
  update public.vendors set main_shipping_contact_id = null where main_shipping_contact_id in (select id from public.vendor_emails where lower(email) = 'tomdawson@sandboxxgroup.com');
  delete from public.vendor_emails c where lower(c.email) = 'tomdawson@sandboxxgroup.com'
     and not exists (select 1 from public.vendor_confirmations x where x.vendor_email_id = c.id);
end $$;
