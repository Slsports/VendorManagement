-- 0171 — Discontinued items with no replacement, found by a sales report (Dana, Oct 18). A report that finds a * item
-- whose LS note names no usable replacement (none, one not in LS, or a chain that dead-ends) makes one Review card for
-- whoever ran the report, in Unavailable items next to the cards from vendor confirmations. Two buttons: Find
-- replacement (a task on that person's list to source a new item or vendor; the card takes the Vendor ID when found and
-- VMS writes REPLACED WITH to LS) and Don't need (a dated "NO REPLACEMENT NEEDED" note in LS; we stop ordering it).
-- One card per LS item, never a second while the first is open or decided. The report's note links to the card.
alter table public.item_changes add column if not exists source text not null default 'confirmation' check (source in ('confirmation', 'report'));
alter table public.item_changes add column if not exists report_run_id uuid references public.report_runs(id) on delete set null;
alter table public.item_changes add column if not exists task_id uuid references public.tasks(id) on delete set null;
alter table public.item_changes drop constraint if exists item_changes_decision_check;
alter table public.item_changes add constraint item_changes_decision_check
  check (decision in ('replacement', 'discontinued', 'out_of_stock', 'dnr', 'leave', 'find_replacement', 'dont_need'));
create unique index if not exists item_changes_report_item on public.item_changes (organization_id, ls_item_id) where source = 'report';
comment on column public.item_changes.source is 'confirmation: read from a vendor confirmation; report: a sales report found a discontinued item with no replacement on file.';

/**
 * A sales report's dead ends (authenticated: admins, managers and buyers). One row back per LS item: the card that
 * already exists (open or decided), else a new one assigned to the person running the report.
 */
create or replace function public.item_changes_from_report(p_org uuid, p_items jsonb)
returns table (ls_item_id text, change_id uuid, review_item_id uuid, decision text, decided_at timestamptz, task_id uuid, replacement_vendor_item_id text)
language plpgsql security definer set search_path = public as $$
declare
  it  jsonb;
  ch  public.item_changes%rowtype;
  vid uuid;
  vn  text;
  rid uuid;
begin
  if not public.user_in_org(p_org) or not public.user_can_edit() then raise exception 'Not allowed' using errcode = '42501'; end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if nullif(trim(it->>'ls_item_id'), '') is null then continue; end if;
    select * into ch from public.item_changes c where c.organization_id = p_org and c.source = 'report' and c.ls_item_id = trim(it->>'ls_item_id');
    if not found then
      vid := null; vn := null;
      if nullif(trim(it->>'ls_vendor_id'), '') is not null then
        select v.id, v.name into vid, vn from public.vendors v where v.organization_id = p_org and v.lightspeed_vendor_id = trim(it->>'ls_vendor_id') order by v.is_active desc, v.created_at limit 1;
      end if;
      insert into public.item_changes (organization_id, vendor_id, item_key, vendor_item_id, item_name, read_as, sure, vendor_words, ls_item_id, ls_name, source)
      values (p_org, vid, trim(it->>'ls_item_id'), nullif(trim(it->>'vendor_item_id'), ''), left(nullif(trim(it->>'item_name'), ''), 200), 'discontinued', true,
              left(nullif(trim(it->>'ls_note'), ''), 500), trim(it->>'ls_item_id'), left(nullif(trim(it->>'item_name'), ''), 200), 'report')
      returning * into ch;
      insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details, assigned_to, assigned_at)
      values (p_org, 'item_change', 'vendor', vid,
              format('%s: %s discontinued, no replacement on file', coalesce(vn, nullif(trim(it->>'ls_vendor_name'), ''), 'Vendor'),
                     coalesce(nullif(trim(it->>'vendor_item_id'), ''), left(coalesce(it->>'item_name', ''), 60))),
              jsonb_build_object('change_id', ch.id, 'vendor_id', vid, 'vendor_name', vn, 'vendor_id_for_rules', vid, 'from_report', true, 'ls_item_id', ch.ls_item_id),
              auth.uid(), case when auth.uid() is not null then now() end)
      returning id into rid;
      update public.item_changes set review_item_id = rid where id = ch.id;
      ch.review_item_id := rid;
    end if;
    ls_item_id := ch.ls_item_id; change_id := ch.id; review_item_id := ch.review_item_id; decision := ch.decision; decided_at := ch.decided_at; task_id := ch.task_id; replacement_vendor_item_id := ch.replacement_vendor_item_id;
    return next;
  end loop;
end;
$$;
revoke execute on function public.item_changes_from_report(uuid, jsonb) from public, anon;
grant execute on function public.item_changes_from_report(uuid, jsonb) to authenticated, service_role;

/** The report run the cards came from (the run row is made after the report is built). */
create or replace function public.item_changes_set_run(p_ids uuid[], p_run uuid)
returns void language sql security definer set search_path = public as $$
  update public.item_changes set report_run_id = p_run where id = any (p_ids) and report_run_id is null and public.user_in_org(organization_id)
$$;
revoke execute on function public.item_changes_set_run(uuid[], uuid) from public, anon;
grant execute on function public.item_changes_set_run(uuid[], uuid) to authenticated, service_role;

/**
 * Deciding, with the two report buttons. Find replacement: a task for the card's person (or whoever clicked), nothing
 * written to LS; the card can later take the replacement's Vendor ID (Use replacement) or Don't need, which finishes the
 * task. Don't need: a dated NO REPLACEMENT NEEDED line in LS.
 */
create or replace function public.item_change_decide(p_change uuid, p_decision text, p_back_date date default null,
                                                     p_reason text default null, p_replacement text default null)
returns public.item_changes language plpgsql security definer set search_path = public as $$
declare
  ch   public.item_changes%rowtype;
  vn   text;
  repl text;
  line text;
  who  uuid;
  tid  uuid;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers decide this' using errcode = '42501'; end if;
  select * into ch from public.item_changes where id = p_change for update;
  if not found or not public.user_in_org(ch.organization_id) then raise exception 'Item not found' using errcode = '23503'; end if;
  if p_decision not in ('replacement', 'discontinued', 'out_of_stock', 'dnr', 'leave', 'find_replacement', 'dont_need') then raise exception 'Unknown choice' using errcode = '22023'; end if;
  if p_decision = 'dnr' and not coalesce((select can_dnr from public.profiles where id = auth.uid()), false) then
    raise exception 'Only Dana, Trevor or Jarrett can choose DNR. Send them a message about it.' using errcode = '42501';
  end if;
  if ch.decision is not null and ch.decision <> 'find_replacement' then raise exception 'This item is already decided' using errcode = '22023'; end if;
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
            when 'dont_need' then 'NO REPLACEMENT NEEDED'
            else '' end;
  if p_decision = 'find_replacement' then
    select r.assigned_to into who from public.review_items r where r.id = ch.review_item_id;
    who := coalesce(who, auth.uid());
    insert into public.tasks (organization_id, title, notes, due_date, assigned_to, created_by, vendor_id, auto_key)
    values (ch.organization_id, left('Find a replacement for ' || coalesce(ch.vendor_item_id || ' ', '') || coalesce(regexp_replace(ch.ls_name, '^\*+\s*', ''), ch.item_name, ''), 200),
            concat_ws(E'\n', 'Discontinued in Lightspeed with no replacement on file' || coalesce(' (LS note: ' || ch.vendor_words || ')', '') || '.',
                      'Source a new item or vendor. When you have it, open the card and enter the replacement''s Vendor ID; VMS writes it to Lightspeed. If nothing replaces it, choose Don''t need.'),
            (now() at time zone 'America/Los_Angeles')::date + 7, who, auth.uid(), ch.vendor_id, 'item_change:' || ch.review_item_id)
    on conflict (organization_id, auto_key) where auto_key is not null do update set assigned_to = excluded.assigned_to, done_at = null, done_by = null
    returning id into tid;
  end if;
  update public.item_changes set
    decision = p_decision,
    replacement_vendor_item_id = case when p_decision = 'replacement' then repl else replacement_vendor_item_id end,
    back_date = case when p_decision = 'out_of_stock' then coalesce(p_back_date, back_date) else back_date end,
    dnr_reason = case when p_decision = 'dnr' then trim(p_reason) end,
    decided_by = auth.uid(), decided_at = now(),
    note_line = case when p_decision in ('leave', 'find_replacement') then null else line end,
    ls_status = case when p_decision in ('leave', 'find_replacement') then 'not_needed' else 'pending' end, ls_error = null,
    task_id = coalesce(tid, task_id)
   where id = p_change returning * into ch;
  -- a replacement found (or not needed after all) finishes the Find replacement task
  if ch.task_id is not null and p_decision <> 'find_replacement' then
    update public.tasks set done_at = now(), done_by = auth.uid(), done_note = case when p_decision = 'replacement' then 'Replaced with ' || repl else 'Not needed' end
     where id = ch.task_id and done_at is null;
  end if;
  update public.review_items set status = case when p_decision = 'leave' then 'rejected'::public.review_status else 'accepted'::public.review_status end,
         resolved_by = auth.uid(), resolved_at = now(),
         resolution_note = case p_decision when 'replacement' then 'Replaced with ' || repl when 'discontinued' then 'Discontinued, no replacement'
                                when 'out_of_stock' then 'Out of stock' when 'dnr' then 'DNR' when 'find_replacement' then 'Finding a replacement'
                                when 'dont_need' then 'Not needed' else 'Left as is' end
   where id = ch.review_item_id and status in ('pending', 'accepted');
  return ch;
end;
$$;
revoke execute on function public.item_change_decide(uuid, text, date, text, text) from public, anon;
grant execute on function public.item_change_decide(uuid, text, date, text, text) to authenticated, service_role;
