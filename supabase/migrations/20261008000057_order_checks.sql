-- 0078 — Order paperwork checks (Dana, Oct 10). Four documents to an order: our order, the LS PO, the vendor's
-- confirmation, the vendor's invoice. "Confirmations are not invoices so they definitely need their own
-- folder." When a confirmation comes in (email or upload) Claude files it, finds the order and compares it with
-- what we ordered; when the invoice comes in, Claude compares it with the final confirmation. Each check is a
-- summary for the person who placed the order (Jarrett's orders to Jarrett, everything else to the admin,
-- Dana), even when everything matches; any check can be handed to someone else. With issues Claude drafts
-- the email to the vendor; a person edits and sends it, never VMS on its own.
alter table public.vendor_links drop constraint if exists vendor_links_kind_check;
alter table public.vendor_links add constraint vendor_links_kind_check check (kind in ('catalog', 'price_list', 'order_form', 'specials', 'website', 'other',
  'invoice', 'credit', 'confirmation', 'order', 'ls_po', 'packing_slip', 'payment', 'freight_bill', 'delivery_receipt'));

-- gmail-sync's paperwork step: looked at for confirmations and invoices.
alter table public.emails add column if not exists paper_scanned_at timestamptz;

create table if not exists public.order_checks (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id       uuid references public.vendors(id) on delete set null,
  order_id        uuid references public.orders(id) on delete set null,
  kind            text not null check (kind in ('confirmation', 'invoice')),
  document_id     uuid not null references public.vendor_links(id) on delete cascade,
  email_id        uuid references public.emails(id) on delete set null,
  -- reading → (needs_order) → comparing → to_review → done; not_paperwork / dismissed / failed on the side
  status          text not null default 'reading' check (status in ('reading', 'needs_order', 'comparing', 'to_review', 'done', 'not_paperwork', 'dismissed', 'failed')),
  working_at      timestamptz,
  reading         jsonb,
  po_number       text,
  doc_number      text,
  doc_date        date,
  doc_total       numeric(12, 2),
  against         text,
  against_ids     uuid[] not null default '{}',
  result          text check (result in ('match', 'issues')),
  summary         text,
  rows            jsonb not null default '[]',
  issues          jsonb not null default '[]',
  draft_to        text[] not null default '{}',
  draft_subject   text,
  draft_body      text,
  read_note       text,
  assigned_to     uuid references public.profiles(id) on delete set null,
  assigned_at     timestamptz,
  reviewed_by     uuid references public.profiles(id) on delete set null,
  reviewed_at     timestamptz,
  outcome         text check (outcome in ('sent', 'no_email')),
  sent_thread_id  uuid references public.email_threads(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (document_id)
);
create index if not exists order_checks_open_idx on public.order_checks (organization_id, assigned_to, created_at) where status in ('needs_order', 'to_review', 'failed');
create index if not exists order_checks_queue_idx on public.order_checks (organization_id, created_at) where status in ('reading', 'comparing');
create index if not exists order_checks_order_idx on public.order_checks (order_id);
alter table public.order_checks enable row level security;
drop policy if exists "order_checks: members read" on public.order_checks;
create policy "order_checks: members read" on public.order_checks for select to authenticated using (public.user_in_org(organization_id));
grant select on table public.order_checks to authenticated;
grant all on table public.order_checks to service_role;
drop trigger if exists order_checks_updated_at on public.order_checks;
create trigger order_checks_updated_at before update on public.order_checks for each row execute function public.set_updated_at();

-- Who looks at an order's paperwork (Dana, Oct 10): whoever placed it in VMS; on the older orders the sheet's
-- "placed by": Jarrett's to Jarrett, everything else (Dana, "D&J", people no longer here) to the admin.
create or replace function public.order_reviewer(p_order uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.id from public.orders o join public.profiles p on p.id = o.placed_by_id where o.id = p_order and p.is_active),
    (select p.id from public.orders o join public.profiles p on p.organization_id = o.organization_id and p.is_active
                  and split_part(lower(p.full_name), ' ', 1) = 'jarrett'
      where o.id = p_order and lower(trim(coalesce(o.placed_by, ''))) in ('jarrett', 'jg', 'jarrett g') limit 1),
    (select id from public.profiles where organization_id = (select organization_id from public.orders where id = p_order) and role = 'admin' and is_active order by created_at limit 1))
$$;
revoke execute on function public.order_reviewer(uuid) from public, anon;
grant execute on function public.order_reviewer(uuid) to authenticated, service_role;

create or replace function public.org_admin(p_org uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.profiles where organization_id = p_org and role = 'admin' and is_active order by created_at limit 1
$$;
revoke execute on function public.org_admin(uuid) from public, anon;
grant execute on function public.org_admin(uuid) to authenticated, service_role;

-- A confirmation or invoice file saved anywhere (email, upload, Save to documents) starts a check.
create or replace function public.order_check_from_document() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind not in ('confirmation', 'invoice') or new.storage_path is null then return new; end if;
  insert into public.order_checks (organization_id, vendor_id, order_id, kind, document_id, email_id, assigned_to, assigned_at)
  values (new.organization_id, new.vendor_id, new.order_id, new.kind, new.id, new.email_id,
          case when new.order_id is not null then public.order_reviewer(new.order_id) end, case when new.order_id is not null then now() end)
  on conflict (document_id) do update set kind = excluded.kind, status = 'reading', reading = null, result = null
   where public.order_checks.kind <> excluded.kind and public.order_checks.status not in ('done', 'dismissed');
  return new;
end;
$$;
drop trigger if exists vendor_links_order_check on public.vendor_links;
create trigger vendor_links_order_check after insert or update of kind, storage_path on public.vendor_links
  for each row execute function public.order_check_from_document();

-- Which order a document belongs to: its PO number, else the vendor's one open order (or the one whose
-- cost is within 3% of the document's total).
create or replace function public.order_check_find_order(p_org uuid, p_vendor uuid, p_kind text, p_po text, p_total numeric, p_date date)
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_po  text := upper(regexp_replace(coalesce(p_po, ''), '[^A-Za-z0-9]', '', 'g'));
  v_ids uuid[];
begin
  if length(v_po) >= 3 then
    select array_agg(id order by (vendor_id is not distinct from p_vendor) desc, order_date desc nulls last) into v_ids
      from public.orders where organization_id = p_org and upper(regexp_replace(coalesce(po_number, ''), '[^A-Za-z0-9]', '', 'g')) = v_po;
    if cardinality(v_ids) = 1 then return v_ids[1]; end if;
    if cardinality(v_ids) > 1 then
      select array_agg(id) into v_ids from public.orders where id = any(v_ids) and vendor_id is not distinct from p_vendor;
      if cardinality(v_ids) = 1 then return v_ids[1]; end if;
    end if;
  end if;
  if p_vendor is null then return null; end if;
  select array_agg(id) into v_ids from public.orders
   where organization_id = p_org and vendor_id = p_vendor
     and status not in ('cancelled', 'paid')
     and (p_kind = 'invoice' or status not in ('received', 'entered', 'ready_to_pay'))
     and (order_date is null or order_date between coalesce(p_date, current_date) - 365 and coalesce(p_date, current_date) + 7);
  if cardinality(v_ids) = 1 then return v_ids[1]; end if;
  if cardinality(v_ids) > 1 and p_total is not null and p_total > 0 then
    select array_agg(id) into v_ids from public.orders
     where id = any(v_ids) and abs(coalesce(est_cost, final_cost, -1e9) - p_total) <= greatest(5, p_total * 0.03);
    if cardinality(v_ids) = 1 then return v_ids[1]; end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.order_check_find_order(uuid, uuid, text, text, numeric, date) from public, anon, authenticated;
grant execute on function public.order_check_find_order(uuid, uuid, text, text, numeric, date) to service_role;

-- What Claude read from the document (order-check): its type and numbers; then the order it belongs to.
create or replace function public.order_check_apply_read(p_check uuid, p_reading jsonb)
returns text
language plpgsql security definer set search_path = public as $$
declare
  c       public.order_checks%rowtype;
  v_type  text := p_reading->>'doc_type';
  v_order uuid;
  v_date  date;
begin
  select * into c from public.order_checks where id = p_check for update;
  if c.id is null then return 'missing'; end if;
  begin v_date := nullif(p_reading->>'doc_date', '')::date; exception when others then v_date := null; end;
  update public.order_checks set reading = p_reading, working_at = null,
         po_number = nullif(p_reading->>'po_number', ''), doc_number = nullif(p_reading->>'doc_number', ''), doc_date = v_date,
         doc_total = nullif(p_reading->>'total', '')::numeric
   where id = p_check;
  update public.vendor_links set doc_number = coalesce(doc_number, nullif(p_reading->>'doc_number', '')), doc_date = coalesce(doc_date, v_date),
         doc_total = coalesce(doc_total, nullif(p_reading->>'total', '')::numeric)
   where id = c.document_id;
  if v_type not in ('confirmation', 'invoice') then
    update public.order_checks set status = 'not_paperwork', read_note = left(coalesce(p_reading->>'note', 'Not an order confirmation or invoice'), 300) where id = p_check;
    return 'not_paperwork';
  end if;
  if v_type <> c.kind then
    -- Claude saw what it really is: refile it (the trigger leaves a check that is already under way alone)
    update public.order_checks set kind = v_type where id = p_check;
    update public.vendor_links set kind = v_type where id = c.document_id;
  end if;
  v_order := coalesce(c.order_id, public.order_check_find_order(c.organization_id, c.vendor_id, v_type, p_reading->>'po_number', nullif(p_reading->>'total', '')::numeric, v_date));
  if v_order is null then
    update public.order_checks set status = 'needs_order', assigned_to = coalesce(assigned_to, public.org_admin(c.organization_id)), assigned_at = coalesce(assigned_at, now()) where id = p_check;
    return 'needs_order';
  end if;
  update public.order_checks set order_id = v_order, status = 'comparing',
         vendor_id = coalesce(vendor_id, (select vendor_id from public.orders where id = v_order)),
         assigned_to = coalesce(assigned_to, public.order_reviewer(v_order)), assigned_at = coalesce(assigned_at, now())
   where id = p_check;
  update public.vendor_links set order_id = v_order where id = c.document_id and order_id is null;
  if c.email_id is not null then update public.emails set order_id = coalesce(order_id, v_order) where id = c.email_id; end if;
  return 'comparing';
end;
$$;
revoke execute on function public.order_check_apply_read(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.order_check_apply_read(uuid, jsonb) to service_role;

-- The comparison (order-check): summary, rows, issues and the draft email; on to the reviewer.
create or replace function public.order_check_apply_compare(p_check uuid, p_result jsonb)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.order_checks set status = 'to_review', working_at = null,
         against = left(p_result->>'against', 300),
         against_ids = coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(coalesce(p_result->'against_ids', '[]')) x), '{}'),
         result = case when jsonb_array_length(coalesce(p_result->'issues', '[]')) = 0 then 'match' else 'issues' end,
         summary = left(p_result->>'summary', 2000),
         rows = coalesce(p_result->'rows', '[]'), issues = coalesce(p_result->'issues', '[]'),
         draft_to = coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p_result->'draft_to', '[]')) x), '{}'),
         draft_subject = nullif(p_result->>'draft_subject', ''), draft_body = nullif(p_result->>'draft_body', ''), read_note = null
   where id = p_check;
end;
$$;
revoke execute on function public.order_check_apply_compare(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.order_check_apply_compare(uuid, jsonb) to service_role;

-- The buttons.
create or replace function public.order_check_action(p_check uuid, p_action text, p_order uuid default null, p_profile uuid default null, p_thread uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  c public.order_checks%rowtype;
  o public.orders%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers handle order paperwork' using errcode = '42501'; end if;
  select * into c from public.order_checks where id = p_check for update;
  if c.id is null or not public.user_in_org(c.organization_id) then raise exception 'Check not found' using errcode = '23503'; end if;
  if p_action = 'set_order' then
    select * into o from public.orders where id = p_order;
    if o.id is null or o.organization_id <> c.organization_id then raise exception 'Order not found' using errcode = '23503'; end if;
    update public.order_checks set order_id = o.id, vendor_id = coalesce(vendor_id, o.vendor_id), status = 'comparing', working_at = null,
           assigned_to = public.order_reviewer(o.id), assigned_at = now() where id = p_check;
    update public.vendor_links set order_id = o.id where id = c.document_id;
  elsif p_action = 'assign' then
    if p_profile is not null and not exists (select 1 from public.profiles where id = p_profile and organization_id = c.organization_id and is_active) then
      raise exception 'Person not found' using errcode = '23503';
    end if;
    update public.order_checks set assigned_to = p_profile, assigned_at = now() where id = p_check;
  elsif p_action in ('done', 'sent') then
    update public.order_checks set status = 'done', outcome = case when p_action = 'sent' then 'sent' else 'no_email' end, sent_thread_id = p_thread,
           reviewed_by = auth.uid(), reviewed_at = now() where id = p_check;
    -- a confirmation looked at: the order is confirmed
    if c.kind = 'confirmation' and c.order_id is not null then
      update public.orders set status = 'confirmed' where id = c.order_id and status in ('open', 'awaiting_confirmation');
    end if;
  elsif p_action = 'recheck' then
    update public.order_checks set status = case when order_id is null then 'reading' else 'comparing' end, working_at = null, read_note = null where id = p_check;
  elsif p_action = 'dismiss' then
    update public.order_checks set status = 'dismissed', reviewed_by = auth.uid(), reviewed_at = now() where id = p_check;
  elsif p_action = 'reopen' then
    update public.order_checks set status = case when result is null then 'comparing' else 'to_review' end, outcome = null, reviewed_by = null, reviewed_at = null where id = p_check;
  else
    raise exception 'Unknown action %', p_action;
  end if;
end;
$$;
revoke execute on function public.order_check_action(uuid, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.order_check_action(uuid, text, uuid, uuid, uuid) to authenticated, service_role;
