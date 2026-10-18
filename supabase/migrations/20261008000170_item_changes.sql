-- 170: unavailable items on vendor confirmations (Dana, Oct 18; docs/sop/item-naming-notes-for-fable.md).
-- When Claude compares a confirmation with our order it also lists the items the vendor says are discontinued, replaced
-- or out of stock. Each becomes an item change with a card in the Review tab of whoever placed the order (the check's
-- reviewer). The card's buttons: Use replacement, Discontinued no replacement, Out of stock (back-in-stock date),
-- DNR (Dana, Trevor and Jarrett only, by name: profiles.can_dnr) and Leave as is. A decision is written to Lightspeed by
-- the lightspeed function (Full access only): * or ** at the start of the name and a dated line on top of the item's
-- note ("10/18/26 DP: REPLACED WITH 71240"; the LS Notes field has no date of its own). The final confirmation email
-- says "… was discontinued, replaced with …". Fable's sales reports read this list too.

alter table public.profiles add column if not exists can_dnr boolean not null default false;
alter table public.profiles add column if not exists note_initials text;
comment on column public.profiles.can_dnr is 'May choose DNR (do not reorder) on an unavailable item (Dana, Oct 18: Dana, Trevor and Jarrett "for now").';
comment on column public.profiles.note_initials is 'Initials VMS writes in front of a note in Lightspeed ("10/18/26 DP: …"); from the name when empty.';
update public.profiles set can_dnr = true
 where is_active and (full_name ilike 'Dana Powell' or full_name ilike 'Trevor%' or full_name ilike 'Jarrett%');

create table if not exists public.item_changes (
  id                          uuid primary key default gen_random_uuid(),
  organization_id             uuid not null references public.organizations(id) on delete cascade,
  vendor_id                   uuid references public.vendors(id) on delete set null,
  order_id                    uuid references public.orders(id) on delete set null,
  check_id                    uuid references public.order_checks(id) on delete cascade,
  item_key                    text not null,
  vendor_item_id              text,
  item_name                   text,
  read_as                     text not null check (read_as in ('discontinued', 'replaced', 'out_of_stock', 'unclear')),
  sure                        boolean not null default false,
  replacement_vendor_item_id  text,
  replacement_name            text,
  replacement_price           numeric(12, 2),
  back_date                   date,
  vendor_words                text,
  ls_item_id                  text,
  ls_name                     text,
  decision                    text check (decision in ('replacement', 'discontinued', 'out_of_stock', 'dnr', 'leave')),
  dnr_reason                  text,
  decided_by                  uuid references public.profiles(id) on delete set null,
  decided_at                  timestamptz,
  note_line                   text,
  ls_status                   text check (ls_status in ('pending', 'written', 'not_needed', 'no_item', 'no_access', 'failed')),
  ls_error                    text,
  ls_written_at               timestamptz,
  review_item_id              uuid references public.review_items(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (check_id, item_key)
);
comment on table public.item_changes is 'Items a vendor confirmation says are discontinued, replaced or out of stock, and the decision made in Review (written to Lightspeed).';
create index if not exists item_changes_vendor on public.item_changes (organization_id, vendor_id, vendor_item_id);
create index if not exists item_changes_order on public.item_changes (order_id);
alter table public.item_changes enable row level security;
drop policy if exists "item_changes: members read" on public.item_changes;
create policy "item_changes: members read" on public.item_changes for select to authenticated using (public.user_in_org(organization_id));
grant select on public.item_changes to authenticated;
grant all on public.item_changes to service_role;
drop trigger if exists item_changes_updated_at on public.item_changes;
create trigger item_changes_updated_at before update on public.item_changes for each row execute function public.set_updated_at();

/** "Dana Powell" → DP; a single name stays whole (JARRETT) until note_initials is set. */
create or replace function public.note_initials_of(p_profile uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(upper(trim(p.note_initials)), ''),
           case when array_length(regexp_split_to_array(trim(coalesce(p.full_name, '')), '\s+'), 1) >= 2
                then upper(left(split_part(trim(p.full_name), ' ', 1), 1) || left(reverse(split_part(reverse(trim(p.full_name)), ' ', 1)), 1))
                else upper(coalesce(nullif(trim(p.full_name), ''), 'VMS')) end)
    from public.profiles p where p.id = p_profile
$$;

/**
 * Claude's reading of a confirmation's unavailable items (service role, from order-check). One change per item; a re-read
 * refreshes what Claude read but never a decision already made. Each new change gets a Review card for the check's
 * reviewer (whoever placed the order). The item in Lightspeed is found by the vendor's LS vendor and the Vendor ID.
 */
create or replace function public.item_changes_from_check(p_check uuid, p_items jsonb)
returns integer language plpgsql security definer set search_path = public as $$
declare
  c   public.order_checks%rowtype;
  v   public.vendors%rowtype;
  it  jsonb;
  k   text;
  ch  public.item_changes%rowtype;
  li_id   text;
  li_name text;
  rid uuid;
  n   integer := 0;
begin
  select * into c from public.order_checks where id = p_check;
  if not found then return 0; end if;
  select * into v from public.vendors where id = c.vendor_id;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    k := upper(coalesce(nullif(trim(it->>'vendor_item_id'), ''), left(trim(coalesce(it->>'item_name', '')), 80)));
    if k = '' or (it->>'read_as') is null then continue; end if;
    li_id := null; li_name := null;
    if v.lightspeed_vendor_id is not null and nullif(trim(it->>'vendor_item_id'), '') is not null then
      select i.item_id, i.description into li_id, li_name from public.ls_items i
       where i.organization_id = c.organization_id and i.default_vendor_id = v.lightspeed_vendor_id
         and upper(i.vendor_item_id) = upper(trim(it->>'vendor_item_id'))
       order by i.archived, i.item_id limit 1;
    end if;
    insert into public.item_changes (organization_id, vendor_id, order_id, check_id, item_key, vendor_item_id, item_name, read_as, sure,
                                     replacement_vendor_item_id, replacement_name, replacement_price, back_date, vendor_words, ls_item_id, ls_name)
    values (c.organization_id, c.vendor_id, c.order_id, c.id, k, nullif(trim(it->>'vendor_item_id'), ''), nullif(trim(it->>'item_name'), ''),
            it->>'read_as', coalesce((it->>'sure')::boolean, false), nullif(trim(it->>'replacement_vendor_item_id'), ''),
            nullif(trim(it->>'replacement_name'), ''), (it->>'replacement_price')::numeric,
            case when it->>'back_date' ~ '^\d{4}-\d{2}-\d{2}$' then (it->>'back_date')::date end,
            left(nullif(trim(it->>'vendor_words'), ''), 500), li_id, li_name)
    on conflict (check_id, item_key) do update set
      vendor_item_id = excluded.vendor_item_id, item_name = excluded.item_name, read_as = excluded.read_as, sure = excluded.sure,
      replacement_vendor_item_id = excluded.replacement_vendor_item_id, replacement_name = excluded.replacement_name,
      replacement_price = excluded.replacement_price, back_date = excluded.back_date, vendor_words = excluded.vendor_words,
      ls_item_id = coalesce(excluded.ls_item_id, item_changes.ls_item_id), ls_name = coalesce(excluded.ls_name, item_changes.ls_name)
     where item_changes.decision is null
    returning * into ch;
    if ch.id is null then continue; end if;
    n := n + 1;
    if ch.review_item_id is null and ch.decision is null then
      insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details, assigned_to, assigned_at)
      values (c.organization_id, 'item_change', 'vendor', c.vendor_id,
              format('%s: %s %s', coalesce(v.name, 'Vendor'), coalesce(ch.vendor_item_id || ' ', ''),
                     case ch.read_as when 'replaced' then 'replaced' when 'discontinued' then 'discontinued'
                                     when 'out_of_stock' then 'out of stock' else 'may not be available' end),
              jsonb_build_object('change_id', ch.id, 'check_id', c.id, 'order_id', c.order_id, 'vendor_id', c.vendor_id,
                                 'vendor_name', v.name, 'vendor_id_for_rules', c.vendor_id),
              c.assigned_to, case when c.assigned_to is not null then now() end)
      returning id into rid;
      update public.item_changes set review_item_id = rid where id = ch.id;
    end if;
    ch := null;
  end loop;
  return n;
end;
$$;
revoke execute on function public.item_changes_from_check(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.item_changes_from_check(uuid, jsonb) to service_role;

/**
 * A person decides an item change. DNR only for profiles.can_dnr. The note line is dated and initialled because the LS
 * Notes field has none. Leave as is writes nothing to Lightspeed.
 */
create or replace function public.item_change_decide(p_change uuid, p_decision text, p_back_date date default null,
                                                     p_reason text default null, p_replacement text default null)
returns public.item_changes language plpgsql security definer set search_path = public as $$
declare
  ch   public.item_changes%rowtype;
  vn   text;
  repl text;
  line text;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers decide this' using errcode = '42501'; end if;
  select * into ch from public.item_changes where id = p_change for update;
  if not found or not public.user_in_org(ch.organization_id) then raise exception 'Item not found' using errcode = '23503'; end if;
  if p_decision not in ('replacement', 'discontinued', 'out_of_stock', 'dnr', 'leave') then raise exception 'Unknown choice' using errcode = '22023'; end if;
  if p_decision = 'dnr' and not coalesce((select can_dnr from public.profiles where id = auth.uid()), false) then
    raise exception 'Only Dana, Trevor or Jarrett can choose DNR. Send them a message about it.' using errcode = '42501';
  end if;
  repl := upper(nullif(trim(coalesce(p_replacement, ch.replacement_vendor_item_id, '')), ''));
  if p_decision = 'replacement' and repl is null then raise exception 'Type the replacement''s Vendor ID' using errcode = '22023'; end if;
  if p_decision = 'dnr' and nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Say why: bad quality, poor seller…' using errcode = '22023'; end if;
  -- the vendor's name without a buying-source tag ("BECKER - WWD" → BECKER)
  select upper(regexp_replace(name, '\s*[-(]\s*(wwd|faire)\b.*$', '', 'i')) into vn from public.vendors where id = ch.vendor_id;
  line := to_char(now() at time zone 'America/Los_Angeles', 'FMMM/FMDD/YY') || ' ' || public.note_initials_of(auth.uid()) || ': ' ||
          case p_decision
            when 'replacement' then 'REPLACED WITH ' || repl
            when 'discontinued' then 'DISCONTINUED BY ' || coalesce(vn, 'VENDOR')
            when 'out_of_stock' then 'OUT OF STOCK AT VENDOR' || coalesce(', BACK ' || to_char(coalesce(p_back_date, ch.back_date), 'FMMM/FMDD/YY'), '')
            when 'dnr' then 'DNR: ' || upper(trim(p_reason))
            else '' end;
  update public.item_changes set
    decision = p_decision,
    replacement_vendor_item_id = case when p_decision = 'replacement' then repl else replacement_vendor_item_id end,
    back_date = case when p_decision = 'out_of_stock' then coalesce(p_back_date, back_date) else back_date end,
    dnr_reason = case when p_decision = 'dnr' then trim(p_reason) end,
    decided_by = auth.uid(), decided_at = now(),
    note_line = case when p_decision = 'leave' then null else line end,
    ls_status = case when p_decision = 'leave' then 'not_needed' else 'pending' end, ls_error = null
   where id = p_change returning * into ch;
  update public.review_items set status = case when p_decision = 'leave' then 'rejected'::public.review_status else 'accepted'::public.review_status end,
         resolved_by = auth.uid(), resolved_at = now(),
         resolution_note = case p_decision when 'replacement' then 'Replaced with ' || repl when 'discontinued' then 'Discontinued, no replacement'
                                when 'out_of_stock' then 'Out of stock' when 'dnr' then 'DNR' else 'Left as is' end
   where id = ch.review_item_id and status = 'pending';
  return ch;
end;
$$;
revoke execute on function public.item_change_decide(uuid, text, date, text, text) from public, anon;
grant execute on function public.item_change_decide(uuid, text, date, text, text) to authenticated, service_role;

/** Someone without DNR asks Dana, Trevor or Jarrett: a task for that person, tied to the order and vendor. */
create or replace function public.item_change_dnr_request(p_change uuid, p_to uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  ch public.item_changes%rowtype;
  tid uuid;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers can ask' using errcode = '42501'; end if;
  select * into ch from public.item_changes where id = p_change;
  if not found or not public.user_in_org(ch.organization_id) then raise exception 'Item not found' using errcode = '23503'; end if;
  if not exists (select 1 from public.profiles where id = p_to and can_dnr and is_active and organization_id = ch.organization_id) then
    raise exception 'Pick Dana, Trevor or Jarrett' using errcode = '22023';
  end if;
  insert into public.tasks (organization_id, title, notes, due_date, assigned_to, created_by, vendor_id, order_id)
  values (ch.organization_id, left('DNR? ' || coalesce(ch.vendor_item_id || ' ', '') || coalesce(ch.item_name, ''), 200),
          concat_ws(E'\n', 'Asked by ' || coalesce((select full_name from public.profiles where id = auth.uid()), 'someone') || ': ' || coalesce(nullif(trim(p_reason), ''), '(no reason given)'),
                    'Open the Review card for this item to choose DNR or something else.'),
          (now() at time zone 'America/Los_Angeles')::date + 1, p_to, auth.uid(), ch.vendor_id, ch.order_id)
  returning id into tid;
  update public.review_items set details = details || jsonb_build_object('dnr_asked', jsonb_build_object('to', p_to, 'task', tid, 'at', now()))
   where id = ch.review_item_id;
  return tid;
end;
$$;
revoke execute on function public.item_change_dnr_request(uuid, uuid, text) from public, anon;
grant execute on function public.item_change_dnr_request(uuid, uuid, text) to authenticated, service_role;

/** What happened in Lightspeed (the lightspeed function). */
create or replace function public.item_change_ls_result(p_change uuid, p_status text, p_error text default null, p_ls_item text default null, p_ls_name text default null)
returns void language sql security definer set search_path = public as $$
  update public.item_changes set ls_status = p_status, ls_error = left(p_error, 500),
         ls_written_at = case when p_status = 'written' then now() else ls_written_at end,
         ls_item_id = coalesce(p_ls_item, ls_item_id), ls_name = coalesce(p_ls_name, ls_name)
   where id = p_change
$$;
revoke execute on function public.item_change_ls_result(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.item_change_ls_result(uuid, text, text, text, text) to service_role;
