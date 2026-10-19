-- 0186 — When a document lands (Dana, Oct 19): "all documents folders should refresh itself when any doc lands in there and
-- there is a next process that is supposed to take place when it lands."
-- • Live refresh: the documents tables are published to Realtime, so every Documents box, the order page, Accounting
--   Documents and the Review tabs update the moment a row lands, whoever filed it (Claude from the mailbox, an upload on
--   another screen, a report run).
-- • The next step fires on landing, not on a timer: a confirmation or invoice starts its order check the second its check
--   row is made (pg_net call to order-check with that check id; the scheduler still catches anything missed).
-- • Proof lands → a task for the orderer to approve it; Mark approved finishes the task.
-- • Packing slip lands → tied to its order (PO number, else the vendor's one open order) and the order moves to Shipped.
-- • Credit lands → a task for Accounting (Dana).
-- • LS PO lands → tied to its order (our PO number, the LS PO number, else the vendor's one open order).

-- ---- Realtime ------------------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  foreach t in array array['vendor_links', 'order_checks', 'accounting_documents', 'sales_reports', 'report_runs', 'review_items', 'ordering_items', 'tasks'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
    -- filters on updates and deletes need the whole old row
    execute format('alter table public.%I replica identity full', t);
  end loop;
end $$;

-- ---- The order check starts the moment the check row lands -----------------------------------------------------------
create or replace function public.order_check_kick() returns trigger
language plpgsql security definer set search_path = public as $$
declare secret text;
begin
  if new.status <> 'reading' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'reading' then return new; end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then return new; end if;
  begin
    select decrypted_secret into secret from vault.decrypted_secrets where name = 'mail_cron_secret';
    if secret is null then return new; end if;
    perform net.http_post(
      url := 'https://bpdpkytfmpbwpbmpejbf.supabase.co/functions/v1/order-check',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
      body := jsonb_build_object('check_id', new.id),
      timeout_milliseconds := 150000);
  exception when others then
    -- never let the call stop the filing; the scheduler runs the check within the minute
    null;
  end;
  return new;
end;
$$;
drop trigger if exists order_checks_kick on public.order_checks;
create trigger order_checks_kick after insert or update of status on public.order_checks
  for each row execute function public.order_check_kick();

-- ---- Who looks after a vendor's paper: the order's placer, else the vendor's buyer, else Dana ------------------------
create or replace function public.document_owner(p_link public.vendor_links) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select o.placed_by_id from public.orders o join public.profiles p on p.id = o.placed_by_id and p.is_active where o.id = p_link.order_id),
    (select v.assigned_buyer_id from public.vendors v join public.profiles p on p.id = v.assigned_buyer_id and p.is_active where v.id = p_link.vendor_id),
    public.org_admin(p_link.organization_id))
$$;
revoke execute on function public.document_owner(public.vendor_links) from public, anon;
grant execute on function public.document_owner(public.vendor_links) to authenticated, service_role;

create or replace function public.document_title(p_link public.vendor_links) returns text
language sql stable as $$
  select coalesce(nullif(trim(p_link.label), ''), nullif(trim(p_link.file_name), ''), 'the file')
$$;

-- ---- Tie an LS PO or packing slip to its order before it is saved ---------------------------------------------------
create or replace function public.vendor_links_tie_order() returns trigger
language plpgsql security definer set search_path = public as $$
declare n text;
begin
  if new.order_id is not null or new.kind not in ('ls_po', 'packing_slip') then return new; end if;
  n := upper(regexp_replace(coalesce(new.doc_number, ''), '[^A-Za-z0-9]', '', 'g'));
  if new.kind = 'ls_po' and length(n) >= 3 then
    select p.order_id into new.order_id from public.ls_pos p
     where p.organization_id = new.organization_id and upper(regexp_replace(coalesce(p.ls_po_number, ''), '[^A-Za-z0-9]', '', 'g')) = n
     order by p.created_at desc limit 1;
    if new.order_id is not null then return new; end if;
  end if;
  new.order_id := public.order_check_find_order(new.organization_id, new.vendor_id, new.kind, new.doc_number, new.doc_total, new.doc_date);
  return new;
end;
$$;
drop trigger if exists vendor_links_tie_order on public.vendor_links;
create trigger vendor_links_tie_order before insert or update of kind, doc_number on public.vendor_links
  for each row execute function public.vendor_links_tie_order();

-- ---- What follows a landing: proof → task, credit → task, packing slip → Shipped -------------------------------------
create or replace function public.vendor_links_next_step() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  vn   text;
  who  uuid;
  st   public.order_status;
begin
  if tg_op = 'DELETE' then
    delete from public.tasks where organization_id = old.organization_id and done_at is null and auto_key in ('proof:' || old.id, 'credit:' || old.id);
    return old;
  end if;
  select name into vn from public.vendors where id = new.vendor_id;
  vn := coalesce(vn, 'the vendor');

  -- a proof to approve (only when it lands as a proof; a proof moved elsewhere drops its task)
  if new.kind = 'proof' and (tg_op = 'INSERT' or old.kind is distinct from 'proof') then
    who := public.document_owner(new);
    if who is not null then
      insert into public.tasks (organization_id, title, notes, due_date, assigned_to, vendor_id, order_id, auto_key)
      values (new.organization_id, format('Approve the proof from %s: %s', vn, public.document_title(new)),
              'Open the vendor''s Proofs folder and look at it. Once the vendor has our OK, click Mark approved on the proof and this task finishes itself.',
              current_date + 3, who, new.vendor_id, new.order_id, 'proof:' || new.id)
      on conflict (organization_id, auto_key) where auto_key is not null do update
        set title = excluded.title, assigned_to = case when public.tasks.done_at is null then public.tasks.assigned_to else excluded.assigned_to end,
            done_at = null, done_by = null, done_note = null;
    end if;
  elsif tg_op = 'UPDATE' and old.kind = 'proof' and new.kind <> 'proof' then
    if new.kind = 'approved_proof' then
      update public.tasks set done_at = now(), done_by = coalesce(new.approved_by, auth.uid()), done_note = 'Approved'
       where organization_id = new.organization_id and auto_key = 'proof:' || new.id and done_at is null;
    else
      delete from public.tasks where organization_id = new.organization_id and auto_key = 'proof:' || new.id and done_at is null;
    end if;
  end if;

  -- a credit for Accounting
  if new.kind = 'credit' and (tg_op = 'INSERT' or old.kind is distinct from 'credit') then
    who := public.org_admin(new.organization_id);
    if who is not null then
      insert into public.tasks (organization_id, title, notes, due_date, assigned_to, vendor_id, order_id, auto_key, area)
      values (new.organization_id, format('Credit from %s: %s', vn, public.document_title(new)),
              'Check it against the invoice it credits and apply it to the next payment to this vendor. The credit is in the vendor''s Credits folder.',
              current_date + 7, who, new.vendor_id, new.order_id, 'credit:' || new.id, 'accounting')
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
drop trigger if exists vendor_links_next_step on public.vendor_links;
create trigger vendor_links_next_step after insert or update of kind, order_id or delete on public.vendor_links
  for each row execute function public.vendor_links_next_step();

-- ---- Back-check (Dana, Oct 14): the new rules on what is already filed --------------------------------------------
-- Proofs not yet approved and credits filed in the last 30 days get their task (older ones are history, not to-dos).
do $$
declare l public.vendor_links%rowtype; n_proof int := 0; n_credit int := 0; n_tied int := 0; n_shipped int := 0; vn text; who uuid; st public.order_status;
begin
  for l in select * from public.vendor_links where kind = 'proof' and created_at >= now() - interval '30 days' loop
    select name into vn from public.vendors where id = l.vendor_id;
    who := public.document_owner(l);
    if who is null then continue; end if;
    insert into public.tasks (organization_id, title, notes, due_date, assigned_to, vendor_id, order_id, auto_key)
    values (l.organization_id, format('Approve the proof from %s: %s', coalesce(vn, 'the vendor'), public.document_title(l)),
            'Open the vendor''s Proofs folder and look at it. Once the vendor has our OK, click Mark approved on the proof and this task finishes itself.',
            current_date + 3, who, l.vendor_id, l.order_id, 'proof:' || l.id)
    on conflict (organization_id, auto_key) where auto_key is not null do nothing;
    if found then n_proof := n_proof + 1; end if;
  end loop;
  for l in select * from public.vendor_links where kind = 'credit' and created_at >= now() - interval '30 days' loop
    select name into vn from public.vendors where id = l.vendor_id;
    who := public.org_admin(l.organization_id);
    if who is null then continue; end if;
    insert into public.tasks (organization_id, title, notes, due_date, assigned_to, vendor_id, order_id, auto_key, area)
    values (l.organization_id, format('Credit from %s: %s', coalesce(vn, 'the vendor'), public.document_title(l)),
            'Check it against the invoice it credits and apply it to the next payment to this vendor. The credit is in the vendor''s Credits folder.',
            current_date + 7, who, l.vendor_id, l.order_id, 'credit:' || l.id, 'accounting')
    on conflict (organization_id, auto_key) where auto_key is not null do nothing;
    if found then n_credit := n_credit + 1; end if;
  end loop;
  -- LS POs and packing slips with no order: tie them; a tied packing slip ships its order
  for l in select * from public.vendor_links where kind in ('ls_po', 'packing_slip') and order_id is null loop
    update public.vendor_links set doc_number = doc_number where id = l.id;   -- runs the tie trigger
    if exists (select 1 from public.vendor_links where id = l.id and order_id is not null) then n_tied := n_tied + 1; end if;
  end loop;
  for l in select * from public.vendor_links where kind = 'packing_slip' and order_id is not null loop
    select status into st from public.orders where id = l.order_id;
    if st in ('open', 'awaiting_confirmation', 'confirmed') then update public.orders set status = 'shipped' where id = l.order_id; n_shipped := n_shipped + 1; end if;
  end loop;
  raise notice 'back-check: % proof tasks, % credit tasks, % documents tied to orders, % orders moved to Shipped', n_proof, n_credit, n_tied, n_shipped;
end $$;
