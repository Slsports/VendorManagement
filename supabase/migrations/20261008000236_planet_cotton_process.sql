-- 0236 — The Planet Cotton process (Dana, Oct 24): "Maryellen and I discuss the order … She sends a spreadsheet for me to
-- agree to, she sends it to Pc, pc sends back a pdf of the sales order along with proofs if needed (if its a reorder
-- usually proof approvals aren't needed …). Then I approve, if required, then they send the invoice with the shipping on it
-- when they ship our order. (They have excellent rates, but I still want them to send me their freight quote so I can see
-- if we can beat their price.)" And their Vendor IDs: "<garment #>/<design #> PT 6934/R6886".
--
--   • vendors.order_sheet_senders: a spreadsheet from one of these people (the rep's order sheet we agree to) is our order:
--     it files to Our orders, on the order its conversation is tied to. Back-check: every such sheet already filed.
--   • vendors.vendor_id_rule: how this vendor's Vendor IDs are built; Claude reads their papers that way (order-check).
--   • vendors.ask_freight_quote: once we approve (the proof, or the confirmation when there is no proof), VMS writes the
--     email asking for their freight quote before it ships, with a task that opens it. Their quote then goes through the
--     freight quote workflow (next to our carriers' prices), and the invoice's freight is checked against the accepted one.
--   • Proof tasks remind right away (Dana: 0 of 28 had a reminder).
--   • A proof approved by our email reply closes its task with a plain note: Approved by your reply on Oct 23, 2026:
--     "Those look great", with that email one click away (tasks.done_email_id).

set local lock_timeout = '5s';

alter table public.vendors add column if not exists order_sheet_senders text[] not null default '{}';
alter table public.vendors add column if not exists vendor_id_rule text;
alter table public.vendors add column if not exists ask_freight_quote boolean not null default false;
comment on column public.vendors.order_sheet_senders is 'Spreadsheets from these addresses are our order (the rep''s order sheet we agree to), filed to Our orders (Dana, Oct 24).';
comment on column public.vendors.vendor_id_rule is 'How this vendor''s Vendor IDs are built, in plain words; Claude reads their papers that way (Planet Cotton: garment #/design #).';
comment on column public.vendors.ask_freight_quote is 'Once we approve the order, VMS drafts the email asking the vendor for their freight quote before it ships (Dana, Oct 24).';
alter table public.tasks add column if not exists done_email_id uuid references public.emails(id) on delete set null;
comment on column public.tasks.done_email_id is 'The email that finished the task (a proof approved by our reply), one click away.';
alter table public.email_threads add column if not exists art_approved_email_id uuid;
comment on column public.email_threads.art_approved_email_id is 'Our email that approved the artwork (Claude''s reading).';

-- ---- the rep's order sheet is our order -------------------------------------------------------------------------
create or replace function public.order_sheet_order(p_email uuid) returns uuid
language sql stable security definer set search_path = public as $$
  -- the order the email, or its conversation, is tied to; only when that is one order
  select coalesce(
    (select order_id from public.emails where id = p_email),
    (select min(x.order_id::text)::uuid from public.emails e join public.emails x on x.thread_id = e.thread_id and x.order_id is not null
      where e.id = p_email having count(distinct x.order_id) = 1))
$$;
revoke execute on function public.order_sheet_order(uuid) from public, anon, authenticated;

create or replace function public.is_order_sheet(p_vendor uuid, p_email uuid, p_file text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p_file ~* '\.(xlsx?|xlsm|csv|numbers)$', false) and exists (
    select 1 from public.vendors v, public.emails e
     where v.id = p_vendor and e.id = p_email and cardinality(v.order_sheet_senders) > 0
       and (lower(e.from_email) = any (v.order_sheet_senders) or lower(e.forwarded_from) = any (v.order_sheet_senders)))
$$;
revoke execute on function public.is_order_sheet(uuid, uuid, text) from public, anon, authenticated;

-- named to run before the other before-insert triggers, so they see the order kind
create or replace function public.vendor_links_order_sheet() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email_id is not null and new.kind not in ('order', 'image', 'proof', 'approved_proof', 'credit', 'damage_photo')
     and public.is_order_sheet(new.vendor_id, new.email_id, coalesce(new.file_name, new.label)) then
    new.kind := 'order';
    new.order_id := coalesce(new.order_id, public.order_sheet_order(new.email_id));
  end if;
  return new;
end;
$$;
revoke execute on function public.vendor_links_order_sheet() from public, anon, authenticated;
drop trigger if exists vendor_links_a_order_sheet on public.vendor_links;
create trigger vendor_links_a_order_sheet before insert on public.vendor_links for each row execute function public.vendor_links_order_sheet();

-- ---- proof tasks remind right away; an approval by our reply says so ---------------------------------------------
create or replace function public.vendor_links_next_step() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  vn   text;
  who  uuid;
  st   public.order_status;
  ap   public.emails%rowtype;
  said text;
begin
  if tg_op = 'DELETE' then
    delete from public.tasks where organization_id = old.organization_id and done_at is null and auto_key in ('proof:' || old.id, 'credit:' || old.id);
    return old;
  end if;
  select name into vn from public.vendors where id = new.vendor_id;
  vn := coalesce(vn, 'the vendor');

  -- a proof to approve (only when it lands as a proof; a proof moved elsewhere drops its task); it reminds right away
  if new.kind = 'proof' and (tg_op = 'INSERT' or old.kind is distinct from 'proof') and coalesce(new.received_at, current_date) >= current_date - 30 then
    who := public.document_owner(new);
    if who is not null then
      insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, order_id, thread_id, auto_key)
      values (new.organization_id, format('Approve the proof from %s: %s', vn, public.document_title(new)),
              'Click Go to it to open the proof. Once the vendor has our OK, click Mark approved on the proof and this task finishes itself.',
              current_date + 3, now(), who, new.vendor_id, new.order_id, public.document_thread(new), 'proof:' || new.id)
      on conflict (organization_id, auto_key) where auto_key is not null do update
        set title = excluded.title, thread_id = coalesce(public.tasks.thread_id, excluded.thread_id), assigned_to = case when public.tasks.done_at is null then public.tasks.assigned_to else excluded.assigned_to end,
            remind_at = case when public.tasks.done_at is null then coalesce(public.tasks.remind_at, now()) else now() end, reminded_at = case when public.tasks.done_at is null then public.tasks.reminded_at end,
            done_at = null, done_by = null, done_note = null, done_email_id = null;
    end if;
  elsif tg_op = 'UPDATE' and old.kind = 'proof' and new.kind <> 'proof' then
    if new.kind = 'approved_proof' then
      -- approved by our reply (Claude read it): the reply, its date and words on the task
      if new.approved_by is null then
        select e.* into ap from public.emails e
         where e.id = (select art_approved_email_id from public.email_threads where id = public.document_thread(new));
        if ap.id is null then
          select e.* into ap from public.emails e
           where e.thread_id = public.document_thread(new) and e.direction = 'out' and e.received_at <= coalesce(new.approved_at, now())
           order by e.received_at desc limit 1;
        end if;
        said := nullif(left(trim(regexp_replace(split_part(split_part(coalesce(ap.body_text, ap.snippet, ''), E'\nOn ', 1), E'\n>', 1), '\s+', ' ', 'g')), 140), '');
      end if;
      update public.tasks set done_at = now(), done_by = coalesce(new.approved_by, auth.uid()),
             done_note = case when ap.id is not null then format('Approved by your reply on %s%s', to_char(ap.received_at at time zone 'America/Los_Angeles', 'Mon FMDD, YYYY'), coalesce(': "' || said || '"', ''))
                              else 'Approved' end,
             done_email_id = ap.id
       where organization_id = new.organization_id and auto_key = 'proof:' || new.id and done_at is null;
    else
      delete from public.tasks where organization_id = new.organization_id and auto_key = 'proof:' || new.id and done_at is null;
    end if;
  end if;

  -- a credit for Accounting
  if new.kind = 'credit' and (tg_op = 'INSERT' or old.kind is distinct from 'credit') and coalesce(new.received_at, current_date) >= current_date - 30 then
    who := public.org_admin(new.organization_id);
    if who is not null then
      insert into public.tasks (organization_id, title, notes, due_date, assigned_to, vendor_id, order_id, thread_id, auto_key, area)
      values (new.organization_id, format('Credit from %s: %s', vn, public.document_title(new)),
              'Click Go to it to open the credit. Check it against the invoice it credits and apply it to the next payment to this vendor.',
              current_date + 7, who, new.vendor_id, new.order_id, public.document_thread(new), 'credit:' || new.id, 'accounting')
      on conflict (organization_id, auto_key) where auto_key is not null do nothing;
    end if;
  elsif tg_op = 'UPDATE' and old.kind = 'credit' and new.kind <> 'credit' then
    delete from public.tasks where organization_id = new.organization_id and auto_key = 'credit:' || new.id and done_at is null;
  end if;

  -- a packing slip: the order is on its way
  if new.kind = 'packing_slip' and new.order_id is not null and (tg_op = 'INSERT' or old.kind is distinct from 'packing_slip' or old.order_id is distinct from new.order_id) then
    select status into st from public.orders where id = new.order_id;
    if st in ('open', 'awaiting_confirmation', 'confirmed') then
      update public.orders set status = 'shipped' where id = new.order_id;
    end if;
  end if;
  return new;
end;
$$;

-- Claude's reading of our reply: an approval remembers which email it was
create or replace function public.mail_apply_art(p_email uuid, p_art text, p_note text) returns text
language plpgsql security definer set search_path = public as $$
declare
  e        public.emails%rowtype;
  t        public.email_threads%rowtype;
  v_who    uuid;
  v_item   uuid;
begin
  select * into e from public.emails where id = p_email;
  if e.id is null then return 'missing'; end if;
  select * into t from public.email_threads where id = e.thread_id for update;
  v_who := public.art_approver(e.organization_id);
  if e.direction = 'out' then
    update public.emails set art_read_at = now(), art_note = left(p_note, 300) where id = p_email;
    if t.art_status in ('waiting', 'needs_changes', 'changes_sent') and e.received_at >= coalesce(t.art_since, '-infinity') then
      if p_art = 'approved' then
        update public.email_threads set art_status = 'approved', art_note = left(p_note, 300), art_approved_email_id = p_email where id = t.id;
        return 'approved';
      elsif p_art = 'changes' then
        update public.email_threads set art_status = 'changes_sent', art_note = left(p_note, 300) where id = t.id;
        return 'changes_sent';
      end if;
    end if;
    return 'skipped';
  end if;

  update public.emails set art_needed = p_art, art_note = left(p_note, 300), art_read_at = now() where id = p_email;
  if p_art = 'yes' then
    -- a new proof restarts the clock only when the last one was settled
    update public.email_threads set art_status = 'waiting', art_note = left(p_note, 300), art_email_id = p_email,
           art_since = case when art_status = 'waiting' then art_since else e.received_at end,
           owner_id = coalesce(v_who, owner_id), owner_set_at = case when v_who is not null and owner_id is distinct from v_who then now() else owner_set_at end,
           status = case when status = 'handled' then 'waiting_on_us' else status end
     where id = t.id and (art_status is distinct from 'approved' or art_since is null or e.received_at > art_since);
    return 'waiting';
  elsif p_art = 'unsure' and t.art_status is null then
    select id into v_item from public.review_items where kind = 'art_approval' and entity_id = t.id and status = 'pending' limit 1;
    if v_item is null then
      insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details, assigned_to, assigned_at)
      values (e.organization_id, 'art_approval', 'email_thread', t.id, 'Artwork to approve? ' || coalesce(nullif(t.subject, ''), '(no subject)'),
              jsonb_build_object('email_id', p_email, 'thread_id', t.id, 'from', coalesce(e.from_name, e.from_email), 'subject', t.subject,
                                 'snippet', e.snippet, 'note', p_note, 'received_at', e.received_at),
              v_who, case when v_who is not null then now() end);
    end if;
    return 'review';
  end if;
  return 'no';
end;
$$;

-- the approval's time: the approving reply when Claude named it, else our newest reply
create or replace function public.thread_art_approved() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_when  timestamptz;
  v_final uuid;
begin
  if new.art_status is distinct from 'approved' or old.art_status is not distinct from 'approved' then return new; end if;
  select received_at into v_when from public.emails where id = new.art_approved_email_id;
  if v_when is null then select max(received_at) into v_when from public.emails where thread_id = new.id and direction = 'out'; end if;
  v_when := coalesce(v_when, now());
  select e.id into v_final from public.emails e join public.vendor_links l on l.email_id = e.id and l.kind = 'proof'
   where e.thread_id = new.id and e.received_at <= v_when order by e.received_at desc limit 1;
  if v_final is null then
    select e.id into v_final from public.emails e join public.vendor_links l on l.email_id = e.id and l.kind = 'proof'
     where e.thread_id = new.id order by e.received_at desc limit 1;
  end if;
  update public.vendor_links set kind = 'approved_proof', approved_at = v_when, approved_by = null, superseded_at = null
   where kind = 'proof' and email_id = v_final;
  update public.vendor_links set superseded_at = v_when
   where kind = 'proof' and superseded_at is null and email_id <> v_final
     and email_id in (select id from public.emails where thread_id = new.id and received_at <= v_when);
  update public.tasks t set done_at = now(), done_note = 'Earlier version, not used'
    from public.vendor_links l
   where t.auto_key = 'proof:' || l.id and t.done_at is null and l.superseded_at is not null
     and l.email_id in (select id from public.emails where thread_id = new.id);
  -- the order: one the conversation's emails or its proofs are filed to
  update public.orders set art_approved_at = v_when
   where art_approved_at is null and id in (
     select order_id from public.emails where thread_id = new.id and order_id is not null
     union select order_id from public.vendor_links where order_id is not null and email_id in (select id from public.emails where thread_id = new.id)
     union select order_id from public.order_checks where order_id is not null and email_id in (select id from public.emails where thread_id = new.id));
  return new;
end;
$$;

-- ---- their freight quote, asked for once we approve -----------------------------------------------------------------
/**
 * The email asking the vendor for their freight quote before the order ships, with a task that opens it (sending it
 * finishes the task). Once per order; not for free-freight orders, orders with a quote already, or while a proof on the
 * order still waits for our OK.
 */
create or replace function public.order_freight_ask(p_order uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  o       public.orders%rowtype;
  v       public.vendors%rowtype;
  c       public.order_checks%rowtype;
  v_to    text;
  v_first text;
  v_who   uuid;
  v_draft uuid;
  v_task  uuid;
begin
  select * into o from public.orders where id = p_order;
  if o.id is null or o.status not in ('open', 'awaiting_confirmation', 'confirmed') or coalesce(o.free_shipping, false) then return null; end if;
  select * into v from public.vendors where id = o.vendor_id;
  if not coalesce(v.ask_freight_quote, false) or v.web_orders then return null; end if;
  if exists (select 1 from public.freight_quotes q where q.order_id = o.id and q.status <> 'declined') then return null; end if;
  if exists (select 1 from public.tasks t where t.organization_id = o.organization_id and t.auto_key = 'fqask:' || o.id) then return null; end if;
  if o.art_approved_at is null and exists (select 1 from public.vendor_links l where l.order_id = o.id and l.kind = 'proof' and l.superseded_at is null) then return null; end if;
  -- who to write to: whoever sent the newest confirmation, else the vendor's email
  select * into c from public.order_checks where order_id = o.id and kind = 'confirmation' and status not in ('not_paperwork', 'dismissed') order by created_at desc limit 1;
  select from_email into v_to from public.emails where id = c.email_id and not public.is_our_address(organization_id, from_email);
  v_to := lower(coalesce(v_to, v.email));
  if v_to is null then return null; end if;
  select split_part(nullif(trim(e.contact_name), ''), ' ', 1) into v_first from public.vendor_emails e where e.vendor_id = v.id and lower(e.email) = v_to limit 1;
  v_who := coalesce(public.order_reviewer(o.id), public.org_admin(o.organization_id));
  insert into public.email_drafts (organization_id, owner_id, created_by, to_emails, subject, body, vendor_id, thread_id, note)
  values (o.organization_id, v_who, null, array[v_to],
          'Freight quote for our PO ' || coalesce(o.po_number, '') || coalesce(' (your order ' || nullif(c.doc_number, '') || ')', ''),
          'Hi ' || coalesce(v_first, 'there') || E',\n\nThank you! Before our order' || coalesce(' (PO ' || o.po_number || ')', '') || ' ships, could you please send us your freight quote:'
            || E' the cost, how many boxes or pallets, and their sizes and weights? We like to compare it with our own carriers. Please hold the shipment until we OK the freight.\n\nThank you!',
          v.id, (select thread_id from public.emails where id = c.email_id), 'Asks for their freight quote before it ships (Dana, Oct 24)')
  returning id into v_draft;
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, order_id, thread_id, auto_key, draft_id)
  values (o.organization_id, left(format('Send the freight quote request: %s, PO %s', v.name, coalesce(o.po_number, '')), 200),
          'The email asking for their freight quote is ready: click Go to it, check it and Send. Sending it finishes this task; their quote then shows under Freight › Freight quotes.',
          current_date, now(), v_who, v.id, o.id, (select thread_id from public.emails where id = c.email_id), 'fqask:' || o.id, v_draft)
  on conflict (organization_id, auto_key) where auto_key is not null do nothing
  returning id into v_task;
  insert into public.activity_log (organization_id, entity_type, entity_id, action, details, actor_id)
  values (o.organization_id, 'order', o.id, 'freight_quote_asked', jsonb_build_object('draft_id', v_draft, 'task_id', v_task, 'note', 'The email asking for their freight quote is in Mail › Drafts'), null);
  return v_draft;
end;
$$;
revoke execute on function public.order_freight_ask(uuid) from public, anon, authenticated;
grant execute on function public.order_freight_ask(uuid) to service_role;

create or replace function public.orders_freight_ask() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.art_approved_at is not null and old.art_approved_at is null then perform public.order_freight_ask(new.id); end if;
  return null;
end;
$$;
revoke execute on function public.orders_freight_ask() from public, anon, authenticated;
drop trigger if exists orders_freight_ask on public.orders;
create trigger orders_freight_ask after update of art_approved_at on public.orders for each row execute function public.orders_freight_ask();

-- no proof (a reorder): approving the confirmation is the go-ahead
create or replace function public.order_checks_freight_ask() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'confirmation' and new.status = 'done' and old.status is distinct from 'done' and new.order_id is not null then
    perform public.order_freight_ask(new.order_id);
  end if;
  return null;
end;
$$;
revoke execute on function public.order_checks_freight_ask() from public, anon, authenticated;
drop trigger if exists order_checks_freight_ask on public.order_checks;
create trigger order_checks_freight_ask after update of status on public.order_checks for each row execute function public.order_checks_freight_ask();

-- ---- Planet Cotton --------------------------------------------------------------------------------------------------
update public.vendors
   set order_sheet_senders = array['maryellenreps@gmail.com'],
       ask_freight_quote = true,
       vendor_id_rule = 'Garment # / design #, like PT 6934/R6886. The garment # is in the Item column. The design # is on its own DESIGN: line (e.g. "DESIGN: R6886: Shaver Lake Mountains FF") and goes with the item lines it covers. One paper can have several garments and several designs. Keep the DESIGN, tags and other charge lines as their own lines, as printed.'
 where id = '8ddde2cd-7328-45b6-8219-b10a8bf97587';

-- Back-check (Oct 14 rule): every sheet already filed from an order-sheet sender is our order, on its order when the
-- conversation is tied to one; a check made on it as a confirmation is closed.
do $$
declare n_kind int; n_order int; n_checks int;
begin
  with s as (
    select l.id, public.order_sheet_order(l.email_id) o
      from public.vendor_links l
     where l.kind not in ('order', 'image', 'proof', 'approved_proof', 'credit', 'damage_photo') and l.email_id is not null
       and public.is_order_sheet(l.vendor_id, l.email_id, coalesce(l.file_name, l.label))
  ), u as (
    update public.vendor_links l set kind = 'order', order_id = coalesce(l.order_id, s.o) from s where l.id = s.id returning l.id, l.order_id
  )
  select count(*), count(order_id) into n_kind, n_order from u;
  update public.order_checks c set status = 'dismissed', working_at = null,
         read_note = 'The rep''s order sheet: it is our order, not their confirmation (Dana, Oct 24). Filed to Our orders.'
   where c.status not in ('done', 'dismissed', 'not_paperwork')
     and c.document_id in (select id from public.vendor_links where kind = 'order' and public.is_order_sheet(vendor_id, email_id, coalesce(file_name, label)));
  get diagnostics n_checks = row_count;
  raise notice 'order sheets refiled to Our orders: % (on an order: %), checks closed: %', n_kind, n_order, n_checks;
end $$;
