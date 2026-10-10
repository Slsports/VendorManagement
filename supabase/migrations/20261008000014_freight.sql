-- 0035 — Freight carriers and freight bills (Dana, Oct 8). Carriers are their own kind of sender, not
-- vendors: PartnerShip and Worldwide Express (ShipStation's billing, do-not-reply@wwex.com) for parcel,
-- Priority One for LTL (anything @pinnacleteam.com is Priority One's scheduling and customer service).
-- All freight mail goes to Trevor (receiving and all things freight). A freight bill can cover several
-- vendors: one line per shipper, each matched to the vendor and its order; the per-invoice fee goes to
-- the biggest order on the bill. Confirmed lines become the order's freight cost.

create table if not exists public.carriers (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  name             text not null,
  mode             text not null default 'parcel' check (mode in ('parcel', 'ltl')),
  email_domains    text[] not null default '{}',
  website          text,
  account_number   text,
  owner_id         uuid references public.profiles(id) on delete set null,
  notes            text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  unique (organization_id, name)
);
comment on table public.carriers is 'Freight carriers and brokers we are billed by. Mail from their domains is freight mail for owner_id.';

alter table public.carriers enable row level security;
drop policy if exists "carriers: members read" on public.carriers;
drop policy if exists "carriers: editors write" on public.carriers;
create policy "carriers: members read" on public.carriers for select to authenticated using (public.user_in_org(organization_id));
create policy "carriers: editors write" on public.carriers for all to authenticated
  using (public.user_can_edit() and public.user_in_org(organization_id)) with check (public.user_can_edit() and public.user_in_org(organization_id));
grant select, insert, update, delete on table public.carriers to authenticated;
grant all on table public.carriers to service_role;

insert into public.carriers (organization_id, name, mode, email_domains, website, account_number, owner_id, notes)
select o.id, c.name, c.mode, c.domains, c.website, c.account,
       (select p.id from public.profiles p where p.organization_id = o.id and p.is_active and lower(p.email) like 'trevor@%' limit 1),
       c.notes
  from public.organizations o
  cross join (values
    ('PartnerShip', 'parcel', array['partnership.com'], 'https://www.partnership.com', null::text, 'Bills by email without the PDF: log in, download the bill and add it to the freight bill in VMS.'),
    ('Worldwide Express (ShipStation)', 'parcel', array['wwex.com', 'speedship.com'], 'https://www.speedship.com', 'W0003290195', 'ShipStation''s billing. Invoices come from do-not-reply@wwex.com with the PDF attached. Not Worldwide Distributors.'),
    ('Priority One', 'ltl', array['priority1.com', 'pinnacleteam.com'], 'https://www.priority1.com', null, 'LTL only. Pinnacle Logistics (Nick, pinnacleteam.com) schedules our shipments and is Priority One''s customer service.')
  ) as c(name, mode, domains, website, account, notes)
 where exists (select 1 from public.mail_accounts m where m.organization_id = o.id)
on conflict (organization_id, name) do nothing;

-- Senders: carriers are their own kind.
alter table public.email_senders add column if not exists carrier_id uuid references public.carriers(id) on delete set null;
alter table public.email_senders drop constraint if exists email_senders_kind_check;
alter table public.email_senders add constraint email_senders_kind_check check (kind in ('unknown', 'vendor', 'rep_group', 'platform', 'carrier', 'not_vendor', 'internal'));
alter table public.email_threads add column if not exists carrier_id uuid references public.carriers(id) on delete set null;
create index if not exists email_threads_carrier_idx on public.email_threads (organization_id, carrier_id) where carrier_id is not null;

create or replace function public.mail_carrier_for(p_org uuid, p_sender_key text)
returns uuid
language sql stable security definer
set search_path = public
as $$
  select c.id from public.carriers c
   where c.organization_id = p_org and c.is_active
     and (split_part(p_sender_key, '@', 2) = any (c.email_domains) or p_sender_key = any (c.email_domains)
          or exists (select 1 from unnest(c.email_domains) d where p_sender_key like '%.' || d))
   order by c.name limit 1
$$;

-- A sender from a carrier's domain is that carrier from the first email on.
create or replace function public.email_senders_carrier()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_carrier uuid;
begin
  if new.kind = 'unknown' then
    v_carrier := public.mail_carrier_for(new.organization_id, new.sender_key);
    if v_carrier is not null then new.kind := 'carrier'; new.carrier_id := v_carrier; new.decided_at := now(); end if;
  end if;
  return new;
end;
$$;
drop trigger if exists email_senders_carrier on public.email_senders;
create trigger email_senders_carrier before insert on public.email_senders for each row execute function public.email_senders_carrier();
revoke execute on function public.email_senders_carrier() from public, anon, authenticated;

-- Freight threads: tagged with the carrier and given to the carrier's owner (Trevor) when nobody has them.
create or replace function public.mail_mark_carrier_thread(p_thread uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_carrier uuid;
  v_owner   uuid;
begin
  select s.carrier_id into v_carrier from public.emails e join public.email_senders s on s.id = e.sender_id
   where e.thread_id = p_thread and s.kind = 'carrier' and s.carrier_id is not null order by e.received_at limit 1;
  if v_carrier is null then return; end if;
  select owner_id into v_owner from public.carriers where id = v_carrier;
  update public.email_threads
     set carrier_id = v_carrier,
         owner_id = coalesce(owner_id, v_owner),
         owner_set_at = case when owner_id is null and v_owner is not null then now() else owner_set_at end
   where id = p_thread and (carrier_id is distinct from v_carrier or (owner_id is null and v_owner is not null));
end;
$$;
revoke execute on function public.mail_mark_carrier_thread(uuid) from public, anon, authenticated;

create or replace function public.emails_mark_carrier()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.email_senders s where s.id = new.sender_id and s.kind = 'carrier') then
    perform public.mail_mark_carrier_thread(new.thread_id);
  end if;
  return null;
end;
$$;
drop trigger if exists emails_mark_carrier on public.emails;
create trigger emails_mark_carrier after insert on public.emails for each row execute function public.emails_mark_carrier();
revoke execute on function public.emails_mark_carrier() from public, anon, authenticated;

-- Carrier mail that names exactly one vendor (or its PO) is filed to that vendor too, like a service's mail.
create or replace function public.mail_link_email(p_email uuid)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  e        public.emails%rowtype;
  s        public.email_senders%rowtype;
  v_addrs  text[];
  v_vendor uuid;
  v_how    text;
  v_ids    uuid[];
begin
  select * into e from public.emails where id = p_email;
  if not found or e.vendor_id is not null then return e.vendor_id is not null; end if;
  v_addrs := case when e.direction = 'in' then array[lower(e.from_email)] else (select array_agg(lower(a)) from unnest(e.to_emails || e.cc_emails) a) end;

  -- 1. the thread already belongs to a vendor
  select th.vendor_id into v_vendor from public.email_threads th where th.id = e.thread_id;
  if v_vendor is not null then v_how := 'thread'; end if;

  -- 2. a known contact address of exactly one vendor
  if v_vendor is null then
    select array_agg(distinct ve.vendor_id) into v_ids
      from public.vendor_emails ve join public.vendors v on v.id = ve.vendor_id and v.is_active
     where ve.organization_id = e.organization_id and lower(ve.email) = any (v_addrs);
    if cardinality(v_ids) = 1 then v_vendor := v_ids[1]; v_how := 'sender'; end if;
  end if;

  -- 3. what a person said about this sender
  if v_vendor is null and e.sender_id is not null then
    select * into s from public.email_senders where id = e.sender_id;
    if s.kind = 'vendor' then
      v_vendor := s.vendor_id; v_how := 'sender';
    elsif s.kind = 'rep_group' then
      select array_agg(v.id) into v_ids from public.vendors v
       where v.rep_group_id = s.rep_group_id and v.is_active and v.id = any (e.mentioned_vendor_ids);
      if cardinality(v_ids) = 1 then v_vendor := v_ids[1]; v_how := 'rep_group'; end if;
    elsif s.kind in ('platform', 'carrier') then
      -- NetSuite, Bill.com, FashionGo…, and freight carriers: mail for many vendors; the email itself has to
      -- name exactly one (Pinnacle about the Stansport PO shows on Stansport too).
      select array_agg(v.id) into v_ids from public.vendors v where v.is_active and v.id = any (e.mentioned_vendor_ids);
      if cardinality(v_ids) = 1 then v_vendor := v_ids[1]; v_how := 'platform'; end if;
    end if;
  end if;

  -- 4. same company domain as exactly one vendor's known contact (never free mail, never ours)
  if v_vendor is null then
    select array_agg(distinct ve.vendor_id) into v_ids
      from public.vendor_emails ve join public.vendors v on v.id = ve.vendor_id and v.is_active
     where ve.organization_id = e.organization_id
       and public.mail_domain(ve.email) = any (select public.mail_domain(a) from unnest(v_addrs) a)
       and not public.mail_is_freemail(public.mail_domain(ve.email))
       and not (public.mail_domain(ve.email) = any (coalesce((select internal_domains from public.mail_accounts where organization_id = e.organization_id), '{}')));
    if cardinality(v_ids) = 1 then v_vendor := v_ids[1]; v_how := 'domain'; end if;
  end if;

  if v_vendor is null then return false; end if;
  update public.emails set vendor_id = v_vendor, match_how = v_how where id = p_email;
  return true;
end;
$$;

-- "A freight carrier" on a "Who is this mail from?" card.
create or replace function public.set_sender_carrier(p_sender uuid, p_carrier uuid)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  s  public.email_senders%rowtype;
  c  public.carriers%rowtype;
  r  record;
  n  integer := 0;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers file mail' using errcode = '42501'; end if;
  select * into s from public.email_senders where id = p_sender for update;
  select * into c from public.carriers where id = p_carrier;
  if s.id is null or c.id is null or not public.user_in_org(s.organization_id) or c.organization_id <> s.organization_id then
    raise exception 'Sender or carrier not found' using errcode = '23503';
  end if;
  update public.email_senders set kind = 'carrier', carrier_id = p_carrier, vendor_id = null, rep_group_id = null, decided_by = auth.uid(), decided_at = now() where id = p_sender;
  update public.review_items set status = 'accepted', resolved_by = auth.uid(), resolved_at = now(), resolution_note = 'Freight carrier: ' || c.name
   where id = s.review_item_id and status = 'pending';
  if not (lower(split_part(s.sender_key, '@', 2)) = any (c.email_domains)) and s.is_domain and not (s.sender_key = any (c.email_domains)) then
    update public.carriers set email_domains = email_domains || s.sender_key where id = p_carrier;
  end if;
  for r in select distinct thread_id from public.emails where sender_id = p_sender loop
    perform public.mail_mark_carrier_thread(r.thread_id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke execute on function public.set_sender_carrier(uuid, uuid) from public, anon;
grant execute on function public.set_sender_carrier(uuid, uuid) to authenticated, service_role;

-- Carriers already in the mail: PartnerShip, Worldwide Express, Priority One / Pinnacle.
do $$
declare
  s record;
  r record;
begin
  for s in select es.*, public.mail_carrier_for(es.organization_id, es.sender_key) as cid from public.email_senders es where es.kind = 'unknown' loop
    continue when s.cid is null;
    update public.email_senders set kind = 'carrier', carrier_id = s.cid, decided_at = now() where id = s.id;
    update public.review_items set status = 'accepted', resolved_at = now(), resolution_note = 'Freight carrier'
     where id = s.review_item_id and status = 'pending';
  end loop;
  for r in select distinct e.thread_id from public.emails e join public.email_senders es on es.id = e.sender_id where es.kind = 'carrier' loop
    perform public.mail_mark_carrier_thread(r.thread_id);
  end loop;
  for r in select e.id, e.thread_id from public.emails e join public.email_senders es on es.id = e.sender_id where es.kind = 'carrier' and e.vendor_id is null loop
    if public.mail_link_email(r.id) then perform public.mail_refresh_thread(r.thread_id, true); end if;
  end loop;
end $$;

-- ShipStation's "Your order has been shipped!" notices are vendors' ship notices sent through ShipStation:
-- a service like Bill.com or Faire, filed by the vendor each one names.
update public.email_senders set kind = 'platform', decided_at = now() where sender_key = 'shipstation.com' and kind = 'unknown';
update public.review_items r set status = 'accepted', resolved_at = now(), resolution_note = 'A service like Bill.com or Faire'
  from public.email_senders s where s.sender_key = 'shipstation.com' and s.review_item_id = r.id and r.status = 'pending';

-- Freight bills -------------------------------------------------------------------------------
create table if not exists public.freight_bills (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  carrier_id       uuid references public.carriers(id) on delete set null,
  email_id         uuid references public.emails(id) on delete set null,
  invoice_number   text,
  invoice_date     date,
  due_date         date,
  total            numeric(12,2),
  fee_amount       numeric(12,2) not null default 0,
  storage_path     text,                                  -- vendor-files/<org>/freight/<uuid>-<file>
  file_name        text,
  status           text not null default 'needs_pdf' check (status in ('needs_pdf', 'reading', 'to_match', 'done', 'failed')),
  read_note        text,
  read_at          timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists freight_bills_org_idx on public.freight_bills (organization_id, status, created_at desc);
create unique index if not exists freight_bills_email_key on public.freight_bills (email_id) where email_id is not null;
comment on table public.freight_bills is 'A carrier invoice. Lines are shipments; each matched to the vendor that shipped it and its order.';

create table if not exists public.freight_bill_lines (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  bill_id          uuid not null references public.freight_bills(id) on delete cascade,
  shipper_name     text,
  ship_date        date,
  tracking         text[] not null default '{}',
  pieces           integer,
  weight_lb        numeric(10,2),
  description      text,
  amount           numeric(12,2) not null default 0,
  fee_amount       numeric(12,2) not null default 0,     -- the bill's per-invoice fee, on the biggest order
  vendor_id        uuid references public.vendors(id) on delete set null,
  order_id         uuid references public.orders(id) on delete set null,
  suggested_vendor_id uuid references public.vendors(id) on delete set null,
  confirmed        boolean not null default false,
  confirmed_by     uuid references public.profiles(id) on delete set null,
  confirmed_at     timestamptz,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists freight_bill_lines_bill_idx on public.freight_bill_lines (bill_id, sort_order);
create index if not exists freight_bill_lines_order_idx on public.freight_bill_lines (order_id) where order_id is not null;

alter table public.freight_bills enable row level security;
alter table public.freight_bill_lines enable row level security;
drop policy if exists "freight_bills: members read" on public.freight_bills;
drop policy if exists "freight_bills: editors write" on public.freight_bills;
drop policy if exists "freight_bill_lines: members read" on public.freight_bill_lines;
drop policy if exists "freight_bill_lines: editors write" on public.freight_bill_lines;
create policy "freight_bills: members read" on public.freight_bills for select to authenticated using (public.user_in_org(organization_id));
create policy "freight_bills: editors write" on public.freight_bills for all to authenticated
  using (public.user_can_edit() and public.user_in_org(organization_id)) with check (public.user_can_edit() and public.user_in_org(organization_id));
create policy "freight_bill_lines: members read" on public.freight_bill_lines for select to authenticated using (public.user_in_org(organization_id));
create policy "freight_bill_lines: editors write" on public.freight_bill_lines for all to authenticated
  using (public.user_can_edit() and public.user_in_org(organization_id)) with check (public.user_can_edit() and public.user_in_org(organization_id));
grant select, insert, update, delete on table public.freight_bills, public.freight_bill_lines to authenticated;
grant all on table public.freight_bills, public.freight_bill_lines to service_role;
drop trigger if exists freight_bills_set_updated_at on public.freight_bills;
create trigger freight_bills_set_updated_at before update on public.freight_bills for each row execute function public.set_updated_at();

alter table public.vendor_links drop constraint if exists vendor_links_kind_check;
alter table public.vendor_links add constraint vendor_links_kind_check check (kind in ('catalog', 'price_list', 'order_form', 'specials', 'website', 'other', 'invoice', 'confirmation', 'order', 'packing_slip', 'payment', 'freight_bill'));

-- An order's freight cost is the sum of its confirmed freight lines (with the fee when it landed there).
create or replace function public.freight_order_cost(p_order uuid)
returns void language sql security definer set search_path = public as $$
  update public.orders o
     set freight_cost = x.total
    from (select sum(l.amount + l.fee_amount) as total from public.freight_bill_lines l where l.order_id = p_order and l.confirmed) x
   where o.id = p_order and x.total is not null;
$$;
revoke execute on function public.freight_order_cost(uuid) from public, anon, authenticated;

-- The per-invoice fee goes to the biggest order on the bill (by wholesale cost), or the biggest line when
-- no line has an order yet.
create or replace function public.freight_place_fee(p_bill uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  b      public.freight_bills%rowtype;
  v_line uuid;
begin
  select * into b from public.freight_bills where id = p_bill;
  if b.id is null then return; end if;
  select l.id into v_line
    from public.freight_bill_lines l left join public.orders o on o.id = l.order_id
   where l.bill_id = p_bill
   order by coalesce(o.final_cost, o.est_cost, o.cost_basis, 0) desc, l.amount desc, l.sort_order
   limit 1;
  update public.freight_bill_lines set fee_amount = case when id = v_line then b.fee_amount else 0 end where bill_id = p_bill;
end;
$$;
revoke execute on function public.freight_place_fee(uuid) from public, anon, authenticated;

-- Trevor matches a line: vendor and order; confirming puts the cost on the order.
create or replace function public.freight_set_line(p_line uuid, p_vendor uuid, p_order uuid, p_confirm boolean)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  l       public.freight_bill_lines%rowtype;
  v_old   uuid;
  v_open  integer;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers match freight' using errcode = '42501'; end if;
  select * into l from public.freight_bill_lines where id = p_line for update;
  if l.id is null or not public.user_in_org(l.organization_id) then raise exception 'Freight line not found' using errcode = '23503'; end if;
  if p_order is not null and not exists (select 1 from public.orders o where o.id = p_order and o.organization_id = l.organization_id and (p_vendor is null or o.vendor_id = p_vendor)) then
    raise exception 'That order is not this vendor''s' using errcode = '22023';
  end if;
  v_old := l.order_id;
  update public.freight_bill_lines
     set vendor_id = coalesce(p_vendor, (select vendor_id from public.orders where id = p_order)), order_id = p_order,
         confirmed = p_confirm and (p_order is not null or p_vendor is not null),
         confirmed_by = case when p_confirm then auth.uid() end, confirmed_at = case when p_confirm then now() end
   where id = p_line;
  perform public.freight_place_fee(l.bill_id);
  for v_old in select distinct x from unnest(array[v_old, p_order] || array(select order_id from public.freight_bill_lines where bill_id = l.bill_id and order_id is not null)) x where x is not null loop
    perform public.freight_order_cost(v_old);
  end loop;
  select count(*) into v_open from public.freight_bill_lines where bill_id = l.bill_id and not confirmed;
  update public.freight_bills set status = case when v_open = 0 then 'done' else 'to_match' end
   where id = l.bill_id and status in ('to_match', 'done');
end;
$$;
revoke execute on function public.freight_set_line(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.freight_set_line(uuid, uuid, uuid, boolean) to authenticated, service_role;
