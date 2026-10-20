-- 0208 — The PO on a vendor's confirmation is checked against ours (Dana, Oct 20: "if the PO doesn't match our PO naming
-- conventions then I want that to be addressed in the confirmation review so we can catch the vendors that either don't
-- list a po in their order confirmation or they do a random one that doesn't fit our naming conventions").
-- Our PO is the vendor's PO code + the order date (YAKIMA080626, a second one that day -2), Oct 13.
--   ours      their PO is the order's PO (case, spaces and dashes aside; extra words like "EARLY BUY" are fine)
--   fits      the order has no PO yet and theirs is in our naming (code + a date)
--   missing   no PO on their confirmation
--   not_ours  the order has our PO and theirs is a different one
--   off       the order has no PO and theirs doesn't fit our naming
-- missing, not_ours and off get the same help a missing PO had: the Create PO task when the order has no PO, else the
-- email in Mail › Drafts asking them to put our PO on their order. Back-check: confirmations from the last 60 days.

create or replace function public.po_norm(p text) returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'))
$$;
grant execute on function public.po_norm(text) to authenticated, service_role;

create or replace function public.po_check_state(p_check uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when not public.is_real_po(x.theirs) then 'missing'
    when public.is_real_po(x.ours) then case when strpos(public.po_norm(x.theirs), public.po_norm(x.ours)) > 0 then 'ours' else 'not_ours' end
    when public.po_norm(x.theirs) ~ ('^' || public.po_norm(x.code) || '[0-9]{5,6}') then 'fits'
    else 'off' end
  from (
    select coalesce(nullif(trim(c.po_number), ''), c.reading->>'po_number') as theirs, o.po_number as ours,
           coalesce(nullif(trim(v.po_code), ''), public.po_code_default(v.name)) as code
      from public.order_checks c
      left join public.orders o on o.id = c.order_id
      left join public.vendors v on v.id = c.vendor_id
     where c.id = p_check
  ) x
$$;
revoke execute on function public.po_check_state(uuid) from public, anon;
grant execute on function public.po_check_state(uuid) to authenticated, service_role;

create or replace function public.order_check_po_followup(p_check uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  c       public.order_checks%rowtype;
  o       public.orders%rowtype;
  v_name  text;
  v_who   uuid;
  v_due   date;
  v_task  uuid;
  v_to    text;
  v_first text;
  v_draft uuid;
  v_num   text;
  v_state text;
  v_theirs text;
begin
  select * into c from public.order_checks where id = p_check for update;
  if c.id is null or c.kind <> 'confirmation' or c.reading is null or c.status in ('not_paperwork', 'dismissed') then return null; end if;
  -- their PO: ours (or in our naming while the order has none yet) needs nothing; missing, someone else's, or a number
  -- that doesn't fit our naming gets the same help (Dana, Oct 20)
  v_state := public.po_check_state(c.id);
  if v_state in ('ours', 'fits') then return null; end if;
  v_theirs := coalesce(nullif(trim(c.po_number), ''), c.reading->>'po_number');
  if exists (select 1 from public.vendors v where v.id = c.vendor_id and v.web_orders) then return null; end if;
  -- an old paper (a re-check of old mail filed it, Oct 16: Ty's July re-order) gets no PO task and no email
  if coalesce(c.doc_date, (select received_at::date from public.emails where id = c.email_id), c.created_at::date) < current_date - 30 then return 'too_old'; end if;
  -- a vendor on hold or not to order from: no PO task or email; the check goes to the admin to look at (Dana, Oct 16)
  if exists (select 1 from public.vendors v where v.id = c.vendor_id and v.standing in ('hold', 'do_not_order')) then
    update public.order_checks set assigned_to = public.org_admin(c.organization_id), assigned_at = now()
     where id = c.id and assigned_to is distinct from public.org_admin(c.organization_id);
    return 'on_hold';
  end if;
  if c.order_id is not null then select * into o from public.orders where id = c.order_id; end if;
  select name into v_name from public.vendors where id = c.vendor_id;
  v_num := coalesce(nullif(trim(c.doc_number), ''), nullif(trim(c.reading->>'doc_number'), ''));
  v_who := coalesce(case when o.id is not null then public.order_reviewer(o.id) end,
                    (select assigned_buyer_id from public.vendors where id = c.vendor_id),
                    c.assigned_to, public.org_admin(c.organization_id));

  if o.id is null or not public.is_real_po(o.po_number) then
    -- no PO yet: the person who placed the order makes one
    if c.po_task_id is null then
      v_due := public.next_business_day(now());
      insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, order_id, thread_id, auto_key)
      values (c.organization_id,
              left('Create PO: ' || coalesce(v_name, 'vendor') || ', ' || coalesce(v_num, 'their confirmation'), 200),
              'The vendor''s confirmation' || coalesce(' ' || v_num, '') || case when public.is_real_po(v_theirs) then ' shows PO ' || v_theirs || ', which isn''t ours' else ' has no PO of ours' end
                || '. Make the PO if there isn''t one and type it on the order'
                || case when o.id is null then ' (pick or add the order on the confirmation check first)' else '' end
                || '. VMS then puts an email in Mail › Drafts asking them to add our PO to their order.',
              v_due, (v_due + time '09:00') at time zone 'America/Los_Angeles', v_who, c.vendor_id, o.id,
              (select thread_id from public.emails where id = c.email_id), 'create_po:' || c.id)
      on conflict (organization_id, auto_key) where auto_key is not null do nothing
      returning id into v_task;
      update public.order_checks set po_task_id = coalesce(v_task, po_task_id) where id = c.id;
      return 'task';
    end if;
    return 'waiting';
  end if;

  -- the order has our PO: the email asking them to put it on their order (once)
  if c.po_draft_id is not null or exists (select 1 from public.order_checks x where x.id = c.id and x.po_draft_id is not null) then return 'drafted'; end if;
  select from_email into v_to from public.emails where id = c.email_id;
  v_to := coalesce(v_to, (select email from public.vendors where id = c.vendor_id));
  if v_to is not null then
    select split_part(nullif(trim(e.contact_name), ''), ' ', 1) into v_first from public.vendor_emails e where e.vendor_id = c.vendor_id and lower(e.email) = lower(v_to) limit 1;
    insert into public.email_drafts (organization_id, owner_id, created_by, to_emails, subject, body, vendor_id, thread_id, note)
    values (c.organization_id, v_who, null, array[lower(v_to)],
            'Our PO ' || o.po_number || coalesce(' for your order ' || v_num, ''),
            'Hi ' || coalesce(v_first, 'there') || E',\n\nThank you for the confirmation' || coalesce(' (' || v_num || ')', '') || '. Please update the order with our PO number '
              || o.po_number || case when public.is_real_po(v_theirs) then ' (your confirmation shows ' || v_theirs || ')' else '' end
              || E' so it shows on the packing list and the invoice.\n\nThank you!',
            c.vendor_id, (select thread_id from public.emails where id = c.email_id),
            case when public.is_real_po(v_theirs) then 'Their confirmation shows PO ' || v_theirs || ', not ours: asks them to change it to ' || o.po_number
                 else 'Their confirmation had no PO of ours: asks them to add PO ' || o.po_number end)
    returning id into v_draft;
  end if;
  update public.order_checks set po_draft_id = v_draft where id = c.id;
  update public.tasks set done_at = now(), done_note = 'PO ' || o.po_number || ' is on the order' || case when v_draft is not null then '; the email asking them to add it is in Mail › Drafts' else '' end
   where id = c.po_task_id and done_at is null;
  return case when v_draft is null then 'no_address' else 'drafted' end;
end;
$$;
revoke execute on function public.order_check_po_followup(uuid) from public, anon, authenticated;
grant execute on function public.order_check_po_followup(uuid) to service_role;

-- back-check: confirmations from the last 60 days (papers older than 30 days get no task or email, as before)
do $$
declare r record; res text; n jsonb := '{}';
begin
  for r in select id from public.order_checks where kind = 'confirmation' and status not in ('not_paperwork', 'dismissed') and created_at > now() - interval '60 days' loop
    res := coalesce(public.order_check_po_followup(r.id), 'nothing');
    n := jsonb_set(n, array[public.po_check_state(r.id) || ':' || res], to_jsonb(coalesce((n->>(public.po_check_state(r.id) || ':' || res))::int, 0) + 1));
  end loop;
  raise notice 'PO back-check: %', n;
end $$;
