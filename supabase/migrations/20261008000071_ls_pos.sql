-- 0092 — LS POs, drafted by Claude (Dana, Oct 12): "Once an order is marked as Placed (confirmed), Claude should create
-- the PO and send it to the person who ordered it. Once they approve it, it goes to Trevor who will review the naming
-- conventions, etc and send it to LS to be created."
--   drafting   → order-check (every minute) builds the lines from the vendor's confirmation (else our order's lines):
--                items matched to LS by Vendor ID or UPC from the vendor's latest sales report keep their LS name and
--                category; new items get a name and category proposed by Claude per the LS category standard
--   to_approve → the person who placed the order (order_reviewer) checks quantities and costs, Approve
--   to_review  → the LS PO reviewer (profiles.reviews_ls_pos; Trevor) checks names and categories, Send to LS
--   ready      → until VMS is connected to LS: Trevor enters it in LS from the file, then types the LS PO number
--   sent       → the number is on the order
-- Each waiting step is a task for that person (dashboard, email, text as they chose), closed when the step is done.
alter table public.profiles add column if not exists reviews_ls_pos boolean not null default false;

create table if not exists public.ls_pos (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  order_id        uuid not null unique references public.orders(id) on delete cascade,
  vendor_id       uuid references public.vendors(id) on delete set null,
  status          text not null default 'drafting' check (status in ('drafting', 'to_approve', 'to_review', 'ready', 'sent')),
  approver_id     uuid references public.profiles(id) on delete set null,
  reviewer_id     uuid references public.profiles(id) on delete set null,
  store_code      text,
  lines           jsonb not null default '[]'::jsonb,
  draft_note      text,
  draft_error     text,
  working_at      timestamptz,
  approved_by     uuid references public.profiles(id) on delete set null,
  approved_at     timestamptz,
  reviewed_by     uuid references public.profiles(id) on delete set null,
  reviewed_at     timestamptz,
  ls_po_number    text,
  sent_at         timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists ls_pos_open_idx on public.ls_pos (organization_id, status) where status <> 'sent';
drop trigger if exists ls_pos_updated_at on public.ls_pos;
create trigger ls_pos_updated_at before update on public.ls_pos for each row execute function public.set_updated_at();

alter table public.ls_pos enable row level security;
drop policy if exists "ls_pos: members read" on public.ls_pos;
create policy "ls_pos: members read" on public.ls_pos for select to authenticated using (public.user_in_org(organization_id));
grant select on table public.ls_pos to authenticated;
grant all on table public.ls_pos to service_role;

-- Who reviews LS POs: the people ticked in Settings (Trevor), else the admin.
create or replace function public.ls_po_reviewer(p_org uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select id from public.profiles where organization_id = p_org and reviews_ls_pos and is_active order by created_at limit 1),
    public.org_admin(p_org))
$$;
revoke execute on function public.ls_po_reviewer(uuid) from public, anon;
grant execute on function public.ls_po_reviewer(uuid) to authenticated, service_role;

-- Start a draft for an order (once). Confirmed orders start on their own; "Draft it" starts one by hand.
create or replace function public.ls_po_start(p_order uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare o public.orders%rowtype; v_id uuid;
begin
  select * into o from public.orders where id = p_order;
  if o.id is null then return null; end if;
  if auth.uid() is not null and not (public.user_in_org(o.organization_id) and public.user_can_edit()) then
    raise exception 'Only admins, managers and buyers draft LS POs' using errcode = '42501';
  end if;
  insert into public.ls_pos (organization_id, order_id, vendor_id, approver_id, reviewer_id, store_code)
  values (o.organization_id, o.id, o.vendor_id, public.order_reviewer(o.id), public.ls_po_reviewer(o.organization_id), o.store_codes[1])
  on conflict (order_id) do nothing
  returning id into v_id;
  return coalesce(v_id, (select id from public.ls_pos where order_id = p_order));
end;
$$;
revoke execute on function public.ls_po_start(uuid) from public, anon;
grant execute on function public.ls_po_start(uuid) to authenticated, service_role;

create or replace function public.orders_start_ls_po() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' and new.ls_po_number is null then
    perform public.ls_po_start(new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists orders_start_ls_po on public.orders;
create trigger orders_start_ls_po after update of status on public.orders for each row execute function public.orders_start_ls_po();

-- The waiting step is a task for whoever it waits on; it closes when the step is done.
create or replace function public.ls_pos_tasks() returns trigger
language plpgsql security definer set search_path = public as $$
declare vname text; label text;
begin
  select v.name into vname from public.vendors v where v.id = new.vendor_id;
  select coalesce(nullif(o.po_number, ''), to_char(o.order_date, 'FMMM/FMDD/YY')) into label from public.orders o where o.id = new.order_id;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  -- close what no longer waits
  update public.tasks set done_at = now(), done_notified_at = now(), done_seen_at = now(),
    done_note = case new.status when 'sent' then 'LS PO ' || coalesce(new.ls_po_number, '') else 'Done' end
  where organization_id = new.organization_id and done_at is null and auto_key like 'lspo:' || new.id || ':%'
    and auto_key <> 'lspo:' || new.id || ':' || new.status;
  if new.status in ('to_approve', 'to_review', 'ready') then
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, order_id, auto_key)
    select new.organization_id,
      case new.status
        when 'to_approve' then format('Approve the LS PO for %s%s', coalesce(vname, 'an order'), coalesce(' (' || label || ')', ''))
        when 'to_review' then format('Review the LS PO for %s%s and send it to LS', coalesce(vname, 'an order'), coalesce(' (' || label || ')', ''))
        else format('Enter the LS PO for %s%s in LS and type its number', coalesce(vname, 'an order'), coalesce(' (' || label || ')', ''))
      end,
      'Open it: Orders › the order › LS PO.', current_date, now(),
      who, new.vendor_id, new.order_id, 'lspo:' || new.id || ':' || new.status
    from (select case when new.status = 'to_approve' then coalesce(new.approver_id, public.org_admin(new.organization_id))
                      else coalesce(new.reviewer_id, public.org_admin(new.organization_id)) end as who) w
    where who is not null
    on conflict (organization_id, auto_key) where auto_key is not null do nothing;
  end if;
  if new.status = 'sent' and new.ls_po_number is not null then
    update public.orders set ls_po_number = new.ls_po_number where id = new.order_id and ls_po_number is distinct from new.ls_po_number;
  end if;
  return new;
end;
$$;
drop trigger if exists ls_pos_tasks on public.ls_pos;
create trigger ls_pos_tasks after insert or update of status on public.ls_pos for each row execute function public.ls_pos_tasks();

-- The people's steps: save changes, approve, send to LS (ready), done with the LS PO number, or redraft.
create or replace function public.ls_po_action(p_id uuid, p_action text, p_lines jsonb default null, p_number text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare p public.ls_pos%rowtype; me uuid := auth.uid(); admin boolean := public.is_admin();
begin
  select * into p from public.ls_pos where id = p_id for update;
  if p.id is null or not public.user_in_org(p.organization_id) or not public.user_can_edit() then
    raise exception 'LS PO not found' using errcode = '23503';
  end if;
  if p.status = 'sent' and p_action <> 'save' then raise exception 'This LS PO is already in LS' using errcode = '22023'; end if;
  if p_lines is not null then
    if jsonb_typeof(p_lines) <> 'array' then raise exception 'Lines must be a list' using errcode = '22023'; end if;
    update public.ls_pos set lines = p_lines where id = p_id;
  end if;
  if p_action = 'save' then return; end if;
  if p_action = 'approve' then
    if p.status <> 'to_approve' then raise exception 'It is not waiting for approval' using errcode = '22023'; end if;
    if not (admin or me = p.approver_id) then raise exception 'Only % or the admin approves this one', (select full_name from public.profiles where id = p.approver_id) using errcode = '42501'; end if;
    update public.ls_pos set status = 'to_review', approved_by = me, approved_at = now() where id = p_id;
  elsif p_action = 'send' then
    if p.status <> 'to_review' then raise exception 'It is not waiting for review' using errcode = '22023'; end if;
    if not (admin or me = p.reviewer_id) then raise exception 'Only the LS PO reviewer or the admin sends it' using errcode = '42501'; end if;
    update public.ls_pos set status = 'ready', reviewed_by = me, reviewed_at = now() where id = p_id;
  elsif p_action = 'done' then
    if nullif(trim(p_number), '') is null then raise exception 'Type the LS PO number' using errcode = '22023'; end if;
    if p.status not in ('to_review', 'ready') then raise exception 'Approve and review it first' using errcode = '22023'; end if;
    if not (admin or me = p.reviewer_id) then raise exception 'Only the LS PO reviewer or the admin finishes it' using errcode = '42501'; end if;
    update public.ls_pos set status = 'sent', ls_po_number = trim(p_number), sent_at = now(),
      reviewed_by = coalesce(reviewed_by, me), reviewed_at = coalesce(reviewed_at, now()) where id = p_id;
  elsif p_action = 'redraft' then
    update public.ls_pos set status = 'drafting', draft_error = null, working_at = null, approved_by = null, approved_at = null where id = p_id;
  elsif p_action = 'back' then
    if p.status not in ('to_review', 'ready') then raise exception 'Nothing to send back' using errcode = '22023'; end if;
    update public.ls_pos set status = 'to_approve', approved_by = null, approved_at = null where id = p_id;
  else
    raise exception 'Unknown action %', p_action using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public.ls_po_action(uuid, text, jsonb, text) from public, anon;
grant execute on function public.ls_po_action(uuid, text, jsonb, text) to authenticated, service_role;

-- The pay-by reminders own only their own automatic tasks.
do $$
declare src text;
begin
  select pg_get_functiondef('public.sync_payment_tasks(uuid)'::regprocedure) into src;
  if position('where x.auto_key is not null and x.done_at is null' in src) = 0 then raise exception 'sync_payment_tasks changed; update this migration'; end if;
  src := replace(src, 'where x.auto_key is not null and x.done_at is null',
                      'where x.auto_key is not null and (x.auto_key like ''wwd:%'' or x.auto_key like ''order:%'') and x.done_at is null');
  execute src;
end $$;
