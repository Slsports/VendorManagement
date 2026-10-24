-- 0235 — "They didn't use our PO" (Dana, Oct 24): "if we have vms let us know they didnt use our po I want vms to draft a
-- friendly email asking them to use our po instead & provide a new confirmation. Then, vms needs to log their response. If
-- they say yes and send an updated confirmation, then it should be noted, the old confirmation goes in a subfolder in the
-- confirmation folder called "old" or something and the updated conf gets tagged as the final (replaced PO xxx). If they
-- say its too late to change, thank them for trying and just use their original po."
--
--   • po_asks: one row per email asking a vendor to add or use our PO (made with the draft by order_check_po_followup).
--     Sending the draft stamps it "asked" (mail_command_sent, called by gmail-send for every draft).
--   • mail-commands reads the vendor's replies in that conversation (po_ask_replies → Claude → po_ask_answer) and logs the
--     answer on the order with the email:
--       yes        they'll change it; VMS waits for the updated confirmation
--       too_late   VMS drafts a thank-you for trying, and the order switches to their PO (noted). If the PO is already in
--                  Lightspeed, changing its Reference # is a Review card for Dana.
--       unclear    nothing changes; still "Asked to use our PO"
--   • The updated confirmation (it shows our PO) replaces the old one: the old paper moves to Confirmations › Old (kept,
--     superseded_at) and the new one is marked "Final (replaced PO …)" (vendor_links.replaced_po).

set local lock_timeout = '5s';

alter table public.vendor_links add column if not exists replaced_po text;
comment on column public.vendor_links.replaced_po is 'An updated confirmation that replaced one with another PO: shown as "Final (replaced PO …)" (Dana, Oct 24).';

create table if not exists public.po_asks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  order_id         uuid not null references public.orders(id) on delete cascade,
  check_id         uuid not null references public.order_checks(id) on delete cascade,
  vendor_id        uuid references public.vendors(id) on delete set null,
  kind             text not null check (kind in ('add', 'use')),
  their_po         text,
  our_po           text not null,
  draft_id         uuid references public.email_drafts(id) on delete set null,
  status           text not null default 'drafted' check (status in ('drafted', 'asked', 'yes', 'replaced', 'too_late')),
  asked_at         timestamptz,
  ask_email_id     uuid references public.emails(id) on delete set null,
  thread_id        uuid references public.email_threads(id) on delete set null,
  read_until       timestamptz,
  answer_note      text,
  answer_email_id  uuid references public.emails(id) on delete set null,
  answered_at      timestamptz,
  thanks_draft_id  uuid references public.email_drafts(id) on delete set null,
  new_check_id     uuid references public.order_checks(id) on delete set null,
  review_item_id   uuid references public.review_items(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (check_id)
);
comment on table public.po_asks is 'Each email asking a vendor to add or use our PO, and what they answered (Dana, Oct 24).';
create index if not exists po_asks_order on public.po_asks (order_id);
alter table public.po_asks enable row level security;
drop policy if exists "po_asks: members read" on public.po_asks;
create policy "po_asks: members read" on public.po_asks for select to authenticated using (public.user_in_org(organization_id));
grant select on public.po_asks to authenticated;
grant all on public.po_asks to service_role;

-- a line on the order's history
create or replace function public.po_ask_log(a public.po_asks, p_action text, p_details jsonb) returns void
language sql security definer set search_path = public as $$
  insert into public.activity_log (organization_id, entity_type, entity_id, action, details, actor_id)
  values (a.organization_id, 'order', a.order_id, p_action,
          jsonb_build_object('their_po', a.their_po, 'our_po', a.our_po, 'po_ask_id', a.id) || coalesce(p_details, '{}'), null)
$$;
revoke execute on function public.po_ask_log(public.po_asks, text, jsonb) from public, anon, authenticated;

-- The updated confirmation (it shows our PO) replaces the asked one: old paper → Confirmations › Old; new one is Final.
create or replace function public.po_ask_replaced(p_check uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare c public.order_checks%rowtype; a public.po_asks%rowtype; n integer := 0;
begin
  select * into c from public.order_checks where id = p_check;
  if c.id is null or c.order_id is null or c.kind <> 'confirmation' then return 0; end if;
  for a in select * from public.po_asks where order_id = c.order_id and check_id <> c.id and status in ('asked', 'yes') for update loop
    update public.vendor_links set superseded_at = coalesce(superseded_at, now()), is_current = false
     where id = (select document_id from public.order_checks where id = a.check_id) and id <> c.document_id;
    update public.vendor_links set replaced_po = coalesce(a.their_po, 'none') where id = c.document_id;
    update public.po_asks set status = 'replaced', new_check_id = c.id, answered_at = coalesce(answered_at, now()) where id = a.id returning * into a;
    perform public.po_ask_log(a, 'po_replaced', jsonb_build_object('check_id', c.id, 'document_id', c.document_id, 'email_id', c.email_id,
      'note', format('Their updated confirmation%s shows our PO %s. The old one (PO %s) moved to Confirmations › Old.', coalesce(' ' || nullif(c.doc_number, ''), ''), a.our_po, coalesce(a.their_po, 'none'))));
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.po_ask_replaced(uuid) from public, anon, authenticated;
grant execute on function public.po_ask_replaced(uuid) to service_role;

-- 0234's follow-up, plus: the ask is recorded with its draft; a confirmation with our PO replaces an asked one.
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
  if v_state = 'ours' then
    perform public.po_ask_replaced(c.id);
    return null;
  end if;
  if v_state = 'fits' then return null; end if;
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
  if c.po_draft_id is not null or exists (select 1 from public.po_asks where check_id = c.id) then return 'drafted'; end if;
  -- they already said it's too late on this order: their PO stands, no second ask
  if exists (select 1 from public.po_asks where order_id = o.id and status = 'too_late') then return 'too_late'; end if;

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
  insert into public.po_asks (organization_id, order_id, check_id, vendor_id, kind, their_po, our_po, draft_id)
  values (c.organization_id, o.id, c.id, c.vendor_id, case when v_state = 'missing' then 'add' else 'use' end,
          case when v_state = 'missing' then null else v_theirs end, o.po_number, v_draft)
  on conflict (check_id) do nothing;
  return 'drafted';
end;
$$;
revoke execute on function public.order_check_po_followup(uuid) from public, anon, authenticated;
grant execute on function public.order_check_po_followup(uuid) to service_role;

-- Sending a draft (gmail-send calls this for every draft): a task's email ticks the task (0232); a PO ask is stamped
-- "asked" and VMS starts watching that conversation for their answer.
create or replace function public.mail_command_sent(p_draft uuid, p_email uuid, p_by uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t public.tasks%rowtype; e public.emails%rowtype; a public.po_asks%rowtype;
begin
  select * into e from public.emails where id = p_email;
  update public.po_asks set status = 'asked', asked_at = coalesce(e.received_at, now()), ask_email_id = p_email,
         thread_id = e.thread_id, read_until = coalesce(e.received_at, now()), draft_id = null
   where draft_id = p_draft and status = 'drafted' returning * into a;
  if a.id is not null then
    perform public.po_ask_log(a, 'po_asked', jsonb_build_object('email_id', p_email, 'thread_id', e.thread_id, 'by', p_by,
      'note', case a.kind when 'add' then format('Asked them to add our PO %s', a.our_po) else format('Asked them to use our PO %s instead of %s and send an updated confirmation', a.our_po, a.their_po) end));
  end if;
  select * into t from public.tasks where draft_id = p_draft limit 1;
  if not found then return; end if;
  update public.tasks set done_at = coalesce(done_at, now()), done_by = coalesce(done_by, p_by), done_note = coalesce(done_note, 'Email sent'),
         thread_id = coalesce(e.thread_id, thread_id), draft_id = null
   where id = t.id;
  if t.auto_key like 'vmscmd:%' and e.thread_id is not null then
    update public.mail_commands set watch_thread_ids = array(select distinct x from unnest(watch_thread_ids || e.thread_id) x), watched_at = coalesce(watched_at, now())
     where id = split_part(t.auto_key, ':', 2)::uuid;
  end if;
end;
$$;

-- Asks with new replies from the vendor in that conversation (not yet read), a few at a time.
create or replace function public.po_ask_replies(p_org uuid)
returns table (ask_id uuid, kind text, their_po text, our_po text, vendor_name text, email_ids uuid[])
language sql stable security definer set search_path = public as $$
  select a.id, a.kind, a.their_po, a.our_po, v.name,
         (select array_agg(e.id order by e.received_at) from public.emails e
           where e.thread_id = a.thread_id and e.direction = 'in' and e.received_at > a.read_until
             and not public.is_our_address(e.organization_id, e.from_email))
    from public.po_asks a left join public.vendors v on v.id = a.vendor_id
   where a.organization_id = p_org and a.status in ('asked', 'yes') and a.thread_id is not null
     and exists (select 1 from public.emails e where e.thread_id = a.thread_id and e.direction = 'in' and e.received_at > a.read_until
                   and not public.is_our_address(e.organization_id, e.from_email))
   order by a.asked_at limit 5
$$;
revoke execute on function public.po_ask_replies(uuid) from public, anon, authenticated;
grant execute on function public.po_ask_replies(uuid) to service_role;

/**
 * Claude's reading of their reply: yes (they'll change it or did), too_late, or unclear. Logged on the order with the
 * email. Too late: the order takes their PO (noted), a thank-you waits in Drafts, and a PO already in Lightspeed becomes a
 * Review card for Dana (its Reference # still shows ours).
 */
create or replace function public.po_ask_answer(p_ask uuid, p_email uuid, p_outcome text, p_note text) returns text
language plpgsql security definer set search_path = public as $$
declare a public.po_asks%rowtype; e public.emails%rowtype; o public.orders%rowtype; v_first text; v_draft uuid; v_item uuid;
begin
  select * into a from public.po_asks where id = p_ask for update;
  if a.id is null then return null; end if;
  select * into e from public.emails where id = p_email;
  update public.po_asks set read_until = greatest(read_until, coalesce(e.received_at, now())) where id = a.id;
  if p_outcome not in ('yes', 'too_late') or a.status not in ('asked', 'yes') then return 'unclear'; end if;
  if p_outcome = 'yes' then
    update public.po_asks set status = 'yes', answer_note = left(p_note, 300), answer_email_id = p_email, answered_at = now() where id = a.id returning * into a;
    perform public.po_ask_log(a, 'po_answer', jsonb_build_object('email_id', p_email, 'thread_id', e.thread_id, 'outcome', 'yes',
      'note', 'They said yes: ' || coalesce(left(p_note, 300), '') || '. Waiting for the updated confirmation.'));
    return 'yes';
  end if;

  -- too late: their PO on the order, a thank-you in Drafts
  select * into o from public.orders where id = a.order_id for update;
  if a.kind = 'use' and public.is_real_po(a.their_po) then
    update public.orders set po_number = a.their_po, po_auto = false,
           notes = concat_ws(E'\n', nullif(notes, ''), format('PO changed from our %s to their %s on %s: they said it was too late to change.', a.our_po, a.their_po, to_char(current_date, 'FMMM/FMDD/YYYY')))
     where id = o.id;
  end if;
  select split_part(nullif(trim(c.contact_name), ''), ' ', 1) into v_first from public.vendor_emails c where c.vendor_id = a.vendor_id and lower(c.email) = lower(e.from_email) limit 1;
  insert into public.email_drafts (organization_id, owner_id, created_by, to_emails, subject, body, vendor_id, thread_id, note)
  values (a.organization_id, coalesce(public.order_reviewer(o.id), public.org_admin(a.organization_id)), null, array[lower(e.from_email)],
          'Re: Our PO ' || a.our_po,
          'Hi ' || coalesce(v_first, 'there') || E',\n\nNo problem at all, thank you for trying!'
            || case when a.kind = 'use' and public.is_real_po(a.their_po) then ' We''ll use ' || a.their_po || ' for this order.' else '' end
            || E' We''ll make sure our PO is on the order up front next time.\n\nThank you!',
          a.vendor_id, e.thread_id, 'Thank-you for trying to change the PO (they said it was too late)')
  returning id into v_draft;
  if a.kind = 'use' and o.ls_order_id is not null and public.is_real_po(a.their_po) then
    insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details, assigned_to, assigned_at)
    values (a.organization_id, 'ls_po_reference', 'order', o.id,
            format('Change the Reference # on the %s PO in Lightspeed from %s to %s?', coalesce((select name from public.vendors where id = a.vendor_id), 'vendor'), a.our_po, a.their_po),
            jsonb_build_object('order_id', o.id, 'ls_order_id', o.ls_order_id, 'from', a.our_po, 'to', a.their_po, 'email_id', p_email, 'thread_id', e.thread_id,
                               'vendor_id', a.vendor_id, 'vendor_name', (select name from public.vendors where id = a.vendor_id)),
            public.org_admin(a.organization_id), now())
    returning id into v_item;
  end if;
  update public.po_asks set status = 'too_late', answer_note = left(p_note, 300), answer_email_id = p_email, answered_at = now(),
         thanks_draft_id = v_draft, review_item_id = v_item
   where id = a.id returning * into a;
  perform public.po_ask_log(a, 'po_answer', jsonb_build_object('email_id', p_email, 'thread_id', e.thread_id, 'outcome', 'too_late', 'draft_id', v_draft,
    'note', 'They said it was too late to change: ' || coalesce(left(p_note, 300), '')
            || case when a.kind = 'use' and public.is_real_po(a.their_po) then format('. The order now uses their PO %s.', a.their_po) else '.' end
            || ' A thank-you is in Mail › Drafts.'));
  return 'too_late';
end;
$$;
revoke execute on function public.po_ask_answer(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.po_ask_answer(uuid, uuid, text, text) to service_role;

-- Dana's answer on the Reference # card: Change it (the lightspeed function writes LS, then calls this) or keep ours.
create or replace function public.ls_po_reference_answer(p_item uuid, p_changed boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r public.review_items%rowtype;
begin
  select * into r from public.review_items where id = p_item for update;
  if r.id is null or r.kind <> 'ls_po_reference' then raise exception 'Card not found' using errcode = '23503'; end if;
  if auth.uid() is not null and not (public.user_in_org(r.organization_id) and public.is_admin()) then raise exception 'Only Dana decides this' using errcode = '42501'; end if;
  if r.status <> 'pending' then return; end if;
  update public.review_items set status = case when p_changed then 'accepted'::public.review_status else 'rejected'::public.review_status end,
         resolved_by = auth.uid(), resolved_at = now(),
         resolution_note = case when p_changed then 'Reference # changed in Lightspeed to ' || (r.details->>'to') else 'Kept ' || (r.details->>'from') || ' in Lightspeed' end
   where id = p_item;
end;
$$;
revoke execute on function public.ls_po_reference_answer(uuid, boolean) from public, anon;
grant execute on function public.ls_po_reference_answer(uuid, boolean) to authenticated, service_role;

-- the drafts already waiting (made by 0234's version today) get their ask row
insert into public.po_asks (organization_id, order_id, check_id, vendor_id, kind, their_po, our_po, draft_id)
select c.organization_id, c.order_id, c.id, c.vendor_id,
       case when public.po_check_state(c.id) = 'missing' then 'add' else 'use' end,
       case when public.po_check_state(c.id) = 'missing' then null else coalesce(nullif(trim(c.po_number), ''), c.reading->>'po_number') end,
       o.po_number, c.po_draft_id
  from public.order_checks c join public.orders o on o.id = c.order_id
 where c.po_draft_id is not null and public.is_real_po(o.po_number) and public.po_check_state(c.id) in ('missing', 'not_ours', 'off')
on conflict (check_id) do nothing;
