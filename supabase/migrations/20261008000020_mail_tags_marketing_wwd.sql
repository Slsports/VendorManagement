-- 0041 — Dana, Oct 8 (evening):
-- * One email, many vendors: Worldwide's warehouse wrote about a pallet with Newell coolers, Eastman
--   Footwear, Motor Max, Kids Galaxy and Lanard; the email belongs to each of them. email_vendor_tags,
--   rolled up to email_threads.tagged_vendor_ids so a vendor's Mail shows it.
-- * Worldwide's mail (worldwidebuygroup.com) was answered "PNW USA INC" by a slip on a review card: 164
--   emails went to PNW. Worldwide is a service that writes about many vendors; its warehouse address files
--   to the holding vendor "Worldwide Warehouse".
-- * Worldwide Warehouse: portal orders whose real vendor shows only on the invoice (the "Import Toys"
--   program was made into a vendor by the order-guide import). Orders move to the real vendor later.
-- * The freight rate Worldwide quotes for a pallet (10.7%) is the freight % for each vendor on it.
-- * Two more answers on "Who is this mail from?": Marketing (ads from a company we never bought from:
--   Offers & catalogs, no vendor) and Other – not a vendor (a person who may need an answer: Needs
--   attention, waiting on us, Dana's).

-- Sender kinds ---------------------------------------------------------------------------------
alter table public.email_senders drop constraint if exists email_senders_kind_check;
alter table public.email_senders add constraint email_senders_kind_check check (kind in ('unknown', 'vendor', 'rep_group', 'platform', 'carrier', 'marketing', 'not_vendor', 'internal'));

-- Tags -------------------------------------------------------------------------------------------
create table if not exists public.email_vendor_tags (
  email_id         uuid not null references public.emails(id) on delete cascade,
  vendor_id        uuid not null references public.vendors(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  how              text not null default 'auto' check (how in ('auto', 'ai', 'manual')),
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  primary key (email_id, vendor_id)
);
create index if not exists email_vendor_tags_vendor_idx on public.email_vendor_tags (vendor_id);
comment on table public.email_vendor_tags is 'Vendors an email is about besides the one it is filed to (a Worldwide pallet email names five).';

alter table public.email_vendor_tags enable row level security;
drop policy if exists "email_vendor_tags: members read" on public.email_vendor_tags;
drop policy if exists "email_vendor_tags: editors write" on public.email_vendor_tags;
create policy "email_vendor_tags: members read" on public.email_vendor_tags for select to authenticated using (public.user_in_org(organization_id));
create policy "email_vendor_tags: editors write" on public.email_vendor_tags for all to authenticated
  using (public.user_can_edit() and public.user_in_org(organization_id)) with check (public.user_can_edit() and public.user_in_org(organization_id));
grant select, insert, delete on table public.email_vendor_tags to authenticated;
grant all on table public.email_vendor_tags to service_role;

alter table public.email_threads add column if not exists tagged_vendor_ids uuid[] not null default '{}';
create index if not exists email_threads_tagged_idx on public.email_threads using gin (tagged_vendor_ids);

create or replace function public.email_vendor_tags_rollup()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_thread uuid;
begin
  select thread_id into v_thread from public.emails where id = coalesce(new.email_id, old.email_id);
  update public.email_threads t
     set tagged_vendor_ids = coalesce((select array_agg(distinct g.vendor_id) from public.email_vendor_tags g join public.emails e on e.id = g.email_id where e.thread_id = v_thread), '{}')
   where t.id = v_thread;
  return null;
end;
$$;
drop trigger if exists email_vendor_tags_rollup on public.email_vendor_tags;
create trigger email_vendor_tags_rollup after insert or delete on public.email_vendor_tags for each row execute function public.email_vendor_tags_rollup();
revoke execute on function public.email_vendor_tags_rollup() from public, anon, authenticated;

-- Mail from senders that write about many vendors (services, carriers, rep groups) is tagged to every
-- vendor it names.
create or replace function public.mail_auto_tag(p_email uuid)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  e  public.emails%rowtype;
  n  integer;
begin
  select * into e from public.emails where id = p_email;
  if e.id is null or cardinality(e.mentioned_vendor_ids) = 0 then return 0; end if;
  if not exists (select 1 from public.email_senders s where s.id = e.sender_id and s.kind in ('platform', 'carrier', 'rep_group')) then
    return 0;
  end if;
  insert into public.email_vendor_tags (email_id, vendor_id, organization_id, how)
  select e.id, v.id, e.organization_id, 'auto'
    from public.vendors v where v.id = any (e.mentioned_vendor_ids) and v.is_active
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.mail_auto_tag(uuid) from public, anon, authenticated;
grant execute on function public.mail_auto_tag(uuid) to service_role;

create or replace function public.emails_auto_tag()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.mail_auto_tag(new.id);
  return null;
end;
$$;
drop trigger if exists emails_auto_tag on public.emails;
create trigger emails_auto_tag after insert or update of mentioned_vendor_ids, vendor_id on public.emails for each row execute function public.emails_auto_tag();
revoke execute on function public.emails_auto_tag() from public, anon, authenticated;

-- "Also tag a vendor" / remove a tag on an email.
create or replace function public.tag_email_vendor(p_email uuid, p_vendor uuid, p_on boolean)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  e public.emails%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers tag mail' using errcode = '42501'; end if;
  select * into e from public.emails where id = p_email;
  if e.id is null or not public.user_in_org(e.organization_id) then raise exception 'Email not found' using errcode = '23503'; end if;
  if p_on then
    if not exists (select 1 from public.vendors where id = p_vendor and organization_id = e.organization_id) then raise exception 'Vendor not found' using errcode = '23503'; end if;
    insert into public.email_vendor_tags (email_id, vendor_id, organization_id, how, created_by)
    values (p_email, p_vendor, e.organization_id, 'manual', auth.uid()) on conflict do nothing;
  else
    delete from public.email_vendor_tags where email_id = p_email and vendor_id = p_vendor;
  end if;
end;
$$;
revoke execute on function public.tag_email_vendor(uuid, uuid, boolean) from public, anon;
grant execute on function public.tag_email_vendor(uuid, uuid, boolean) to authenticated, service_role;

-- Freight % ----------------------------------------------------------------------------------------
alter table public.emails add column if not exists freight_pct numeric(6,3);
comment on column public.emails.freight_pct is 'A freight rate the email quotes as a percent of cost (Worldwide''s pallet rate, 10.7%).';
alter table public.emails add column if not exists vendors_read_at timestamptz;
comment on column public.emails.vendors_read_at is 'When Claude read the vendor names and freight rate out of this email (mail from many-vendor senders).';
alter table public.orders add column if not exists freight_pct numeric(6,3);
alter table public.orders add column if not exists freight_pct_note text;
comment on column public.orders.freight_pct is 'Freight as a percent of cost when it comes as a rate (a Worldwide pallet), used at check-in instead of freight cost.';

-- Worldwide Warehouse ---------------------------------------------------------------------------------
do $$
declare
  v_org   uuid;
  v_ww    uuid;
  v_it    uuid;
begin
  for v_org in select distinct organization_id from public.vendors where name = 'Import Toys' or exists (select 1 from public.email_senders s where s.sender_key = 'worldwidebuygroup.com' and s.organization_id = vendors.organization_id) loop
    select id into v_ww from public.vendors where organization_id = v_org and name = 'Worldwide Warehouse';
    select id into v_it from public.vendors where organization_id = v_org and name = 'Import Toys';
    if v_ww is null and v_it is not null then
      update public.vendors set name = 'Worldwide Warehouse', needs_review = false, review_note = null,
             notes = trim(both E'\n' from coalesce(notes, '') || E'\nHolding vendor for Worldwide portal orders until the invoice shows the real vendor (Dana, Oct 8). Was "Import Toys", a Worldwide program.')
       where id = v_it;
      v_ww := v_it;
      update public.orders set notes = trim(both E'\n' from coalesce(notes, '') || E'\nWWD program: Import Toys (May Cheong, per Worldwide''s warehouse; customs hold Oct 1).')
       where vendor_id = v_ww;
      update public.review_items set status = 'accepted', resolved_at = now(), resolution_note = 'Renamed Worldwide Warehouse'
       where status = 'pending' and entity_type = 'vendor' and entity_id = v_ww;
    elsif v_ww is null then
      insert into public.vendors (organization_id, name, notes) values (v_org, 'Worldwide Warehouse', 'Holding vendor for Worldwide portal orders until the invoice shows the real vendor.') returning id into v_ww;
    end if;
    insert into public.vendor_billing_routes (vendor_id, route, is_default) values (v_ww, 'worldwide', true) on conflict do nothing;
    insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, contact_type, source)
    values (v_org, v_ww, 'warehouse@worldwidebuygroup.com', 'Worldwide warehouse', 'shipping', 'manual'),
           (v_org, v_ww, 'sues@worldwidebuygroup.com', 'Sue Shaughnessy', 'shipping', 'manual')
    on conflict do nothing;
  end loop;
end $$;

-- Worldwide's mail: a service, not PNW ----------------------------------------------------------------
do $$
declare
  s     record;
  v_pnw uuid;
  t     record;
  e     record;
begin
  for s in select * from public.email_senders where sender_key = 'worldwidebuygroup.com' loop
    select id into v_pnw from public.vendors where organization_id = s.organization_id and name = 'PNW USA INC';
    update public.email_senders set kind = 'platform', vendor_id = null where id = s.id;
    for t in
      select th.id from public.email_threads th
       where th.organization_id = s.organization_id and th.vendor_id = v_pnw
         and exists (select 1 from public.emails x where x.thread_id = th.id and x.sender_id = s.id)
         and not exists (select 1 from public.emails x where x.thread_id = th.id and (x.from_email ilike 'mayzhou%' or 'mayzhoupnw123@gmail.com' = any (x.to_emails)))
    loop
      update public.email_threads set vendor_id = null where id = t.id;
      update public.emails set vendor_id = null, match_how = null where thread_id = t.id and coalesce(match_how, '') <> 'manual';
      for e in select id from public.emails where thread_id = t.id order by received_at loop
        perform public.mail_link_email(e.id);
        perform public.mail_auto_tag(e.id);
      end loop;
      perform public.mail_refresh_thread(t.id, true);
    end loop;
  end loop;
end $$;

-- Tag what is already in the mail from many-vendor senders.
do $$ declare r record; begin
  for r in select e.id from public.emails e join public.email_senders s on s.id = e.sender_id
            where s.kind in ('platform', 'carrier', 'rep_group') and cardinality(e.mentioned_vendor_ids) > 0 loop
    perform public.mail_auto_tag(r.id);
  end loop;
end $$;

-- Move an order to its real vendor (a Worldwide Warehouse order once the invoice names the vendor): its
-- files and its emails go along.
create or replace function public.move_order_vendor(p_order uuid, p_vendor uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  o public.orders%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers move orders' using errcode = '42501'; end if;
  select * into o from public.orders where id = p_order for update;
  if o.id is null or not public.user_in_org(o.organization_id) then raise exception 'Order not found' using errcode = '23503'; end if;
  if not exists (select 1 from public.vendors where id = p_vendor and organization_id = o.organization_id) then raise exception 'Vendor not found' using errcode = '23503'; end if;
  update public.orders set vendor_id = p_vendor where id = p_order;
  update public.vendor_links set vendor_id = p_vendor where order_id = p_order and vendor_id = o.vendor_id;
  update public.emails set vendor_id = p_vendor where order_id = p_order and vendor_id = o.vendor_id;
  update public.email_threads t set vendor_id = p_vendor
   where t.vendor_id = o.vendor_id and exists (select 1 from public.emails e where e.thread_id = t.id and e.order_id = p_order);
  insert into public.activity_log (organization_id, entity_type, entity_id, action, details, actor_id)
  values (o.organization_id, 'order', p_order, 'order_vendor_changed', jsonb_build_object('from', o.vendor_id, 'to', p_vendor), auth.uid());
end;
$$;
revoke execute on function public.move_order_vendor(uuid, uuid) from public, anon;
grant execute on function public.move_order_vendor(uuid, uuid) to authenticated, service_role;

-- Marketing and Other -------------------------------------------------------------------------------
create or replace function public.resolve_email_sender(p_sender uuid, p_kind text, p_vendor uuid default null, p_rep_group uuid default null)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  s        public.email_senders%rowtype;
  r        record;
  v_linked integer := 0;
  v_admin  uuid;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers decide senders'; end if;
  select * into s from public.email_senders where id = p_sender for update;
  if not found or not public.user_in_org(s.organization_id) then raise exception 'Sender not found'; end if;
  if p_kind not in ('vendor', 'rep_group', 'platform', 'marketing', 'not_vendor', 'internal') then raise exception 'Unknown answer %', p_kind; end if;
  if p_kind = 'vendor' and not exists (select 1 from public.vendors where id = p_vendor and organization_id = s.organization_id) then raise exception 'Pick a vendor'; end if;
  if p_kind = 'rep_group' and not exists (select 1 from public.rep_groups where id = p_rep_group and organization_id = s.organization_id) then raise exception 'Pick a rep group'; end if;

  update public.email_senders set kind = p_kind,
    vendor_id = case when p_kind = 'vendor' then p_vendor end,
    rep_group_id = case when p_kind = 'rep_group' then p_rep_group end,
    -- Marketing always goes to Offers & catalogs; Other always stays in Needs attention.
    view_rule = case p_kind when 'marketing' then 'offers' when 'not_vendor' then 'attention' else view_rule end,
    decided_by = auth.uid(), decided_at = now()
  where id = p_sender;
  update public.review_items set status = case when p_kind in ('vendor', 'rep_group', 'platform') then 'accepted'::public.review_status else 'rejected'::public.review_status end,
         resolved_by = auth.uid(), resolved_at = now(),
         resolution_note = case p_kind when 'vendor' then 'Vendor: ' || (select name from public.vendors where id = p_vendor)
                                       when 'rep_group' then 'Rep group: ' || (select name from public.rep_groups where id = p_rep_group)
                                       when 'platform' then 'A service like Bill.com or Faire'
                                       when 'marketing' then 'Marketing'
                                       when 'not_vendor' then 'Other – not a vendor' else 'Ours' end
   where id = s.review_item_id and status = 'pending';

  if p_kind in ('vendor', 'rep_group', 'platform') then
    for r in select id, thread_id from public.emails where sender_id = p_sender and vendor_id is null loop
      if public.mail_link_email(r.id) then v_linked := v_linked + 1; end if;
      perform public.mail_auto_tag(r.id);
      perform public.mail_refresh_thread(r.thread_id, false);
    end loop;
  elsif p_kind in ('marketing', 'not_vendor') then
    perform public.mail_classify(s.organization_id, (select array_agg(id) from public.emails where sender_id = p_sender));
    if p_kind = 'not_vendor' then
      select id into v_admin from public.profiles where organization_id = s.organization_id and role = 'admin' and is_active order by created_at limit 1;
      update public.email_threads t set owner_id = v_admin, owner_set_at = now()
       where t.owner_id is null and v_admin is not null
         and exists (select 1 from public.emails e where e.thread_id = t.id and e.sender_id = p_sender);
    end if;
  end if;
  return v_linked;
end;
$$;
