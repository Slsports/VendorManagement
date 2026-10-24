-- 0234 — Every order gets our PO as soon as it is in VMS, and no more Create PO tasks (Dana, Oct 24): "I dont like the
-- create po task, I think its confusing. The system just needs to know the po we are using so the correspondence is easy
-- to track. The only create po should be when Trevor creates it in lightspeed with all the item attached of what we are
-- expecting." And: "We usually always give them our po".
--
--   • A new order gets our PO: the vendor's PO code + the order date (YAKIMA080626), -2 for a second order that day.
--     It can be changed on the order. Nothing is made in Lightspeed then; the LS PO is made once, with its items, when
--     Trevor sends the approved LS PO draft to Lightspeed. Retail stores (Costco, Amazon…) keep their own order numbers.
--   • po_auto: the PO was made by VMS (not typed or imported). Until a paper comes in for the order, a VMS-made PO follows
--     a change of the order's vendor or date.
--   • A confirmation that shows our PO written another way (OKUMA9126 for OKUMA090126, PLANET101926 for
--     PLANETCOTTON101926) counts as ours.
--   • order_check_po_followup makes no task any more: no PO on their confirmation → the email asking them to add ours;
--     a different PO → the email asking them to use ours and send an updated confirmation. Both wait in Mail › Drafts,
--     one click from the review; nothing is sent on its own.
--   • Back-check: open and confirmed orders with no PO get ours by their order date, unless their confirmation already
--     shows ours (then the order keeps it as the vendor wrote it). The open Create PO tasks are closed (at Dana's request).

set local lock_timeout = '5s';

alter table public.orders add column if not exists po_auto boolean not null default false;
comment on column public.orders.po_auto is 'The PO was made by VMS (vendor PO code + order date), not typed or imported (Dana, Oct 24).';

-- Our PO for a vendor and date; p_skip is the order itself (so it never counts against its own number).
create or replace function public.po_number_make(p_org uuid, p_vendor uuid, p_date date, p_skip uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare base text; n integer := 1; cand text;
begin
  select coalesce(nullif(trim(v.po_code), ''), public.po_code_default(v.name)) || to_char(coalesce(p_date, current_date), 'MMDDYY')
    into base from public.vendors v where v.id = p_vendor;
  if base is null then return null; end if;
  cand := base;
  while exists (select 1 from public.orders x where x.organization_id = p_org and x.id is distinct from p_skip and upper(x.po_number) = upper(cand)) loop
    n := n + 1;
    cand := base || '-' || n;
  end loop;
  return cand;
end;
$$;
revoke execute on function public.po_number_make(uuid, uuid, date, uuid) from public, anon, authenticated;
grant execute on function public.po_number_make(uuid, uuid, date, uuid) to service_role;

create or replace function public.po_number_next(p_order uuid) returns text
language sql stable security definer set search_path = public as $$
  select public.po_number_make(o.organization_id, o.vendor_id, coalesce(o.order_date, o.created_at::date, current_date), o.id)
    from public.orders o where o.id = p_order
$$;
revoke execute on function public.po_number_next(uuid) from public, anon;
grant execute on function public.po_number_next(uuid) to authenticated, service_role;

-- Ours written another way: the same vendor letters (or one starts the other, 4+ letters) and the same date with or without
-- leading zeros. OKUMA9126 = OKUMA090126; PLANET101926 = PLANETCOTTON101926; LAZY9226 = LAZYONE090226.
create or replace function public.po_same(p_theirs text, p_ours text) returns boolean
language sql immutable as $$
  with x as (
    select substring(public.po_norm(p_theirs) from '^([A-Z]+)[0-9]') tl, substring(public.po_norm(p_theirs) from '^[A-Z]+([0-9]+)') td,
           substring(public.po_norm(p_ours) from '^([A-Z]+)[0-9]') ol, substring(public.po_norm(p_ours) from '^[A-Z]+([0-9]{6})') od
  )
  select coalesce(
    (x.tl = x.ol or (least(length(x.tl), length(x.ol)) >= 4 and (starts_with(x.ol, x.tl) or starts_with(x.tl, x.ol))))
    and x.td = any (array[x.od,
                          ltrim(substr(x.od, 1, 2), '0') || substr(x.od, 3, 4),
                          substr(x.od, 1, 2) || ltrim(substr(x.od, 3, 2), '0') || substr(x.od, 5, 2),
                          ltrim(substr(x.od, 1, 2), '0') || ltrim(substr(x.od, 3, 2), '0') || substr(x.od, 5, 2)]), false)
    from x
$$;
grant execute on function public.po_same(text, text) to authenticated, service_role;

create or replace function public.po_check_state(p_check uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when not public.is_real_po(x.theirs) then 'missing'
    when public.is_real_po(x.ours) then case when strpos(public.po_norm(x.theirs), public.po_norm(x.ours)) > 0 or public.po_same(x.theirs, x.ours) then 'ours' else 'not_ours' end
    when public.po_norm(x.theirs) ~ (case when x.code is not null then '^' || public.po_norm(x.code) || '[0-9]{4,6}' else '^[A-Z]{2,}[0-9]{4,6}' end) then 'fits'
    else 'off' end
  from (
    select coalesce(nullif(trim(c.po_number), ''), c.reading->>'po_number') as theirs, o.po_number as ours, nullif(trim(v.po_code), '') as code
      from public.order_checks c
      left join public.orders o on o.id = c.order_id
      left join public.vendors v on v.id = c.vendor_id
     where c.id = p_check
  ) x
$$;

-- every order gets our PO (retail stores keep their own order numbers)
create or replace function public.orders_our_po() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.vendor_id is null or exists (select 1 from public.vendors v where v.id = new.vendor_id and v.is_retail_store) then return new; end if;
  if tg_op = 'UPDATE' then
    if new.po_number is distinct from old.po_number then
      -- a person or an import set it (VMS itself says po_auto)
      if new.po_auto is not distinct from old.po_auto then new.po_auto := false; end if;
    elsif new.po_auto and new.ls_order_id is null and (new.vendor_id is distinct from old.vendor_id or new.order_date is distinct from old.order_date)
          and not exists (select 1 from public.order_checks c where c.order_id = new.id) then
      new.po_number := public.po_number_make(new.organization_id, new.vendor_id, coalesce(new.order_date, old.created_at::date), new.id);
    end if;
  end if;
  if not public.is_real_po(new.po_number) then
    new.po_number := public.po_number_make(new.organization_id, new.vendor_id,
                       coalesce(new.order_date, case when tg_op = 'UPDATE' then old.created_at::date end, current_date), new.id);
    new.po_auto := new.po_number is not null;
  end if;
  return new;
end;
$$;
revoke execute on function public.orders_our_po() from public, anon, authenticated;
drop trigger if exists orders_our_po on public.orders;
create trigger orders_our_po before insert or update of po_number, vendor_id, order_date on public.orders for each row execute function public.orders_our_po();

-- Their PO on a confirmation: ours needs nothing; none → the email asking them to add ours; a different one → the email
-- asking them to use ours and send an updated confirmation. No task (Dana, Oct 24).
create or replace function public.order_check_po_followup(p_check uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  c        public.order_checks%rowtype;
  o        public.orders%rowtype;
  v_who    uuid;
  v_to     text;
  v_first  text;
  v_draft  uuid;
  v_num    text;
  v_state  text;
  v_theirs text;
begin
  select * into c from public.order_checks where id = p_check for update;
  if c.id is null or c.kind <> 'confirmation' or c.reading is null or c.status in ('not_paperwork', 'dismissed') then return null; end if;
  v_state := public.po_check_state(c.id);
  if v_state in ('ours', 'fits') then return null; end if;
  v_theirs := coalesce(nullif(trim(c.po_number), ''), c.reading->>'po_number');
  if exists (select 1 from public.vendors v where v.id = c.vendor_id and (v.web_orders or v.is_retail_store)) then return null; end if;
  -- an old paper (a re-check of old mail filed it, Oct 16) gets no email
  if coalesce(c.doc_date, (select received_at::date from public.emails where id = c.email_id), c.created_at::date) < current_date - 30 then return 'too_old'; end if;
  -- a vendor on hold or not to order from: no email; the check goes to the admin to look at (Dana, Oct 16)
  if exists (select 1 from public.vendors v where v.id = c.vendor_id and v.standing in ('hold', 'do_not_order')) then
    update public.order_checks set assigned_to = public.org_admin(c.organization_id), assigned_at = now()
     where id = c.id and assigned_to is distinct from public.org_admin(c.organization_id);
    return 'on_hold';
  end if;
  -- the order is picked on the review first; then this runs again
  if c.order_id is null then return 'no_order'; end if;
  select * into o from public.orders where id = c.order_id;
  if not public.is_real_po(o.po_number) then return 'no_po'; end if;
  if c.po_draft_id is not null then return 'drafted'; end if;

  v_num := coalesce(nullif(trim(c.doc_number), ''), nullif(trim(c.reading->>'doc_number'), ''));
  v_who := coalesce(public.order_reviewer(o.id), (select assigned_buyer_id from public.vendors where id = c.vendor_id), c.assigned_to, public.org_admin(c.organization_id));
  select from_email into v_to from public.emails where id = c.email_id;
  v_to := coalesce(v_to, (select email from public.vendors where id = c.vendor_id));
  if v_to is null then return 'no_address'; end if;
  select split_part(nullif(trim(e.contact_name), ''), ' ', 1) into v_first from public.vendor_emails e where e.vendor_id = c.vendor_id and lower(e.email) = lower(v_to) limit 1;
  insert into public.email_drafts (organization_id, owner_id, created_by, to_emails, subject, body, vendor_id, thread_id, note)
  values (c.organization_id, v_who, null, array[lower(v_to)],
          'Our PO ' || o.po_number || coalesce(' for your order ' || v_num, ''),
          case when v_state = 'missing' then
            'Hi ' || coalesce(v_first, 'there') || E',\n\nThank you for the confirmation' || coalesce(' (' || v_num || ')', '') || '. Please add our PO number '
              || o.po_number || E' to the order so it shows on the packing list and the invoice.\n\nThank you!'
          else
            'Hi ' || coalesce(v_first, 'there') || E',\n\nThank you for the confirmation' || coalesce(' (' || v_num || ')', '') || '. It shows PO ' || v_theirs
              || ', but our PO for this order is ' || o.po_number || '. Could you please change the order to our PO and send us an updated confirmation?'
              || E' That way it matches on the packing list and the invoice.\n\nThank you so much!'
          end,
          c.vendor_id, (select thread_id from public.emails where id = c.email_id),
          case when v_state = 'missing' then 'Their confirmation had no PO: asks them to add ours, ' || o.po_number
               else 'Their confirmation shows PO ' || v_theirs || ', not ours: asks them to use ' || o.po_number || ' and send an updated confirmation' end)
  returning id into v_draft;
  update public.order_checks set po_draft_id = v_draft where id = c.id;
  return 'drafted';
end;
$$;
revoke execute on function public.order_check_po_followup(uuid) from public, anon, authenticated;
grant execute on function public.order_check_po_followup(uuid) to service_role;

-- Back-check: open and confirmed orders with no PO. Their confirmation already showing ours → keep it as they wrote it;
-- else ours by the order date (one at a time, so a second order that day gets -2).
do $$
declare o record; v_theirs text; v_ours text; n_theirs int := 0; n_ours int := 0;
begin
  for o in
    select x.* from public.orders x join public.vendors v on v.id = x.vendor_id
     where x.status in ('open', 'confirmed') and not public.is_real_po(x.po_number) and not v.is_retail_store
     order by coalesce(x.order_date, x.created_at::date), x.created_at
  loop
    v_ours := public.po_number_make(o.organization_id, o.vendor_id, coalesce(o.order_date, o.created_at::date), o.id);
    select coalesce(nullif(trim(c.po_number), ''), c.reading->>'po_number') into v_theirs
      from public.order_checks c
     where c.order_id = o.id and c.kind = 'confirmation' and c.status not in ('not_paperwork', 'dismissed')
       and public.is_real_po(coalesce(nullif(trim(c.po_number), ''), c.reading->>'po_number'))
       and (public.po_same(coalesce(nullif(trim(c.po_number), ''), c.reading->>'po_number'), v_ours)
            -- no order date to compare: their PO is the vendor's letters and a date
            or (o.order_date is null and coalesce((
                  select z.tl = z.ol or (least(length(z.tl), length(z.ol)) >= 4 and (starts_with(z.ol, z.tl) or starts_with(z.tl, z.ol)))
                    from (select substring(public.po_norm(coalesce(nullif(trim(c.po_number), ''), c.reading->>'po_number')) from '^([A-Z]+)[0-9]{4,6}') tl,
                                 substring(public.po_norm(v_ours) from '^([A-Z]+)') ol) z), false)))
     order by c.created_at desc limit 1;
    if v_theirs is not null then
      update public.orders set po_number = trim(v_theirs), po_auto = false where id = o.id;
      n_theirs := n_theirs + 1;
    else
      update public.orders set po_number = v_ours, po_auto = true where id = o.id;
      n_ours := n_ours + 1;
    end if;
    v_theirs := null;
  end loop;
  raise notice 'orders given our PO: %, kept the PO their confirmation shows: %', n_ours, n_theirs;
end $$;

-- the open Create PO tasks: closed, as Dana asked
update public.tasks
   set done_at = now(), closed_how = 'request',
       done_note = 'Dana asked to stop Create PO tasks (Oct 24): every order now gets our PO when it is made in VMS, and the LS PO is made once, with its items, when the LS PO draft is sent to Lightspeed.'
 where auto_key like 'create_po:%' and done_at is null;
