-- 119: hold reminders and fewer wrong Create PO tasks (Dana, Oct 16, "go").
-- Ty is on hold with "look again on 1/18/2027", but that date only showed on Ty's page: nothing reminded anyone. And
-- the Oct 15 spreadsheet re-check filed Charlene's July 31 re-order sheet as a Ty confirmation, which made a "Create PO:
-- TY INC" task for an old order while Ty is on hold.
--
-- 1. A vendor on hold with a look-again date gets a task on that date for the person it is assigned to (else the
--    admin), with the hold note; a new date moves it, and it closes when the vendor is no longer on hold.
-- 2. order_check_po_followup: no Create PO task or "add our PO" email for a paper more than 30 days old, and none for a
--    vendor on hold or do-not-order (that check goes to the admin instead).
-- 3. The Ty task from the re-check is closed.

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
begin
  select * into c from public.order_checks where id = p_check for update;
  if c.id is null or c.kind <> 'confirmation' or c.reading is null or c.status in ('not_paperwork', 'dismissed') then return null; end if;
  if public.is_real_po(c.reading->>'po_number') then return null; end if;
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
              'The vendor''s confirmation' || coalesce(' ' || v_num, '') || ' has no PO of ours. Make the PO if there isn''t one and type it on the order'
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
              || o.po_number || E' so it shows on the packing list and the invoice.\n\nThank you!',
            c.vendor_id, (select thread_id from public.emails where id = c.email_id),
            'Their confirmation had no PO of ours: asks them to add PO ' || o.po_number)
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

create or replace function public.vendor_hold_task()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  k text := 'hold_review:' || new.id || ':' || coalesce(new.standing_review_date::text, '');
begin
  -- an open reminder for another date, or for a vendor no longer on hold, is not needed any more
  update public.tasks set done_at = now(), done_note = case when new.standing = 'hold' then 'The look-again date changed' else 'No longer on hold' end
   where vendor_id = new.id and auto_key like 'hold_review:%' and done_at is null
     and (auto_key <> k or new.standing <> 'hold' or new.standing_review_date is null);
  if new.standing <> 'hold' or new.standing_review_date is null then return new; end if;
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, auto_key)
  values (new.organization_id, left(new.name || ': look again (on hold)', 200),
          left('On hold until today. ' || coalesce(new.do_not_order_reason, 'Decide whether to order again.'), 4000),
          new.standing_review_date, (new.standing_review_date + time '09:00') at time zone 'America/Los_Angeles',
          coalesce(new.assigned_buyer_id, public.org_admin(new.organization_id)), new.id, k)
  on conflict (organization_id, auto_key) where auto_key is not null
  do update set notes = excluded.notes, assigned_to = excluded.assigned_to
   where public.tasks.done_at is null;
  return new;
end;
$$;
drop trigger if exists vendors_hold_task on public.vendors;
create trigger vendors_hold_task after insert or update of standing, standing_review_date, do_not_order_reason, assigned_buyer_id on public.vendors
  for each row execute function public.vendor_hold_task();

-- back-check: every vendor already on hold with a date (Ty, Jan 18, 2027)
update public.vendors set standing = standing where standing = 'hold' and standing_review_date is not null;

-- the Ty task from the re-check
update public.tasks set done_at = now(), done_note = 'Not needed: an old July re-order sheet filed by the Oct 15 re-check; Ty is on hold'
 where auto_key like 'create_po:%' and done_at is null and created_at >= '2026-10-15 21:30+00'
   and vendor_id in (select id from public.vendors where standing in ('hold', 'do_not_order'));
