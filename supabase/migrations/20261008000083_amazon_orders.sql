-- 0104 — Amazon purchases (Dana, Oct 12): "Anytime Tyler & Greg place an order they need to use a PO and it needs to start with
-- their initials, then the store code (SLS, SLH, SLM, GS). TP is Tyler Powell, GP is Greg Powell and DP is me. Put all Tyler's
-- and Greg's order confirmations in an Amazon file; the ones with my name go through our system as we built. I would like to
-- know how much we are spending every month and on what store." Claude reads every Amazon order email (orders@ and Dana's own
-- inboxes): order number, PO, total, items, dates. DP orders also go through Supplies; TP and GP orders only land here.
-- The Supplies page's Amazon tab lists them with monthly totals by store and by person.

create table if not exists public.po_initials (
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  initials         text not null check (initials = upper(initials)),
  person_name      text not null,
  profile_id       uuid references public.profiles(id) on delete set null,
  goes_to_supplies boolean not null default false,
  primary key (organization_id, initials)
);
comment on table public.po_initials is 'Whose PO it is: the first letters of an Amazon (or other) PO, e.g. TP = Tyler Powell. goes_to_supplies: their orders also fill Supplies requests (Dana).';
alter table public.po_initials enable row level security;
drop policy if exists "po_initials: members read" on public.po_initials;
create policy "po_initials: members read" on public.po_initials for select to authenticated using (public.user_in_org(organization_id));
drop policy if exists "po_initials: admin writes" on public.po_initials;
create policy "po_initials: admin writes" on public.po_initials for all to authenticated
  using (public.is_admin() and public.user_in_org(organization_id)) with check (public.is_admin() and public.user_in_org(organization_id));
grant select, insert, update, delete on table public.po_initials to authenticated;
grant all on table public.po_initials to service_role;

insert into public.po_initials (organization_id, initials, person_name, profile_id, goes_to_supplies)
select o.id, x.i, x.n, (select p.id from public.profiles p where p.organization_id = o.id and p.full_name ilike x.n limit 1), x.s
  from public.organizations o
  cross join (values ('TP', 'Tyler Powell', false), ('GP', 'Greg Powell', false), ('DP', 'Dana Powell', true)) x(i, n, s)
 where exists (select 1 from public.mail_accounts m where m.organization_id = o.id)
on conflict do nothing;

create table if not exists public.amazon_orders (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  order_number     text not null,
  ordered_at       date,
  po               text,
  initials         text,
  store_code       text check (store_code in ('SLS', 'SLH', 'SLM', 'GS')),
  person_name      text,
  total            numeric(12,2),
  items            text,
  status           text not null default 'ordered' check (status in ('ordered', 'shipped', 'delivered', 'cancelled')),
  expected_at      date,
  delivered_at     date,
  email_id         uuid references public.emails(id) on delete set null,
  is_private       boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, order_number)
);
comment on table public.amazon_orders is 'Amazon orders read from the confirmation emails: PO (initials + store), total, items; Supplies › Amazon.';
create index if not exists amazon_orders_month_idx on public.amazon_orders (organization_id, ordered_at desc);
drop trigger if exists amazon_orders_set_updated_at on public.amazon_orders;
create trigger amazon_orders_set_updated_at before update on public.amazon_orders for each row execute function public.set_updated_at();
alter table public.amazon_orders enable row level security;
drop policy if exists "amazon_orders: members read" on public.amazon_orders;
create policy "amazon_orders: members read" on public.amazon_orders for select to authenticated
  using (public.user_in_org(organization_id) and (not is_private or public.is_admin()));
grant select on table public.amazon_orders to authenticated;
grant all on table public.amazon_orders to service_role;

alter table public.emails add column if not exists amazon_read_at timestamptz;
alter table public.emails add column if not exists amazon_order_id uuid references public.amazon_orders(id) on delete set null;

-- The person and store from a PO: "TP-SLS 1012", "GP SLH", "DPGS…".
create or replace function public.po_parse(p_po text)
returns text[] language sql immutable as $$
  select case when m is null then array[null, null]::text[] else array[upper(m[1]), upper(m[2])] end
    from (select regexp_match(coalesce(p_po, ''), '^\s*([A-Za-z]{2})[\s\-_./#]*(SLS|SLH|SLM|GS)', 'i') as m) x
$$;

-- Amazon emails to read: from Amazon, order words, orders@ or the admin's own inboxes. Service role only.
create or replace function public.amazon_queue(p_org uuid, p_limit integer default 10)
returns table (email_id uuid, subject text, body_text text, sent_at timestamptz)
language sql stable security definer set search_path = public as $$
  select e.id, e.subject, left(coalesce(e.body_text, e.snippet), 3000), e.received_at
    from public.emails e left join public.mailboxes m on m.id = e.mailbox_id
   where e.organization_id = p_org and e.direction = 'in' and e.amazon_read_at is null and e.copy_of is null
     and lower(e.from_email) like '%amazon.%'
     and coalesce(e.subject, '') ~* '(order|ordered|shipped|delivered|arriving|cancel)'
     and (e.mailbox_id is null or m.owner_id = public.org_admin(p_org))
     and e.received_at > now() - interval '13 months'
   order by e.received_at
   limit p_limit
$$;

-- Claude's reading of an Amazon email. kind: confirmation / shipped / delivered / cancelled / other.
create or replace function public.amazon_apply(p_email uuid, p_kind text, p_order text, p_po text, p_total numeric, p_items text, p_ordered date, p_expected date)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  e      public.emails%rowtype;
  v_po   text[];
  v_who  public.po_initials%rowtype;
  v_id   uuid;
  v_priv boolean;
begin
  select * into e from public.emails where id = p_email;
  if not found then return null; end if;
  update public.emails set amazon_read_at = now() where id = p_email;
  if p_kind not in ('confirmation', 'shipped', 'delivered', 'cancelled') or nullif(trim(p_order), '') is null then return null; end if;
  v_po := public.po_parse(p_po);
  select * into v_who from public.po_initials where organization_id = e.organization_id and initials = v_po[1];
  v_priv := e.mailbox_id is not null and not exists (select 1 from public.email_threads t where t.id = e.thread_id and t.shared_at is not null);
  insert into public.amazon_orders (organization_id, order_number, ordered_at, po, initials, store_code, person_name, total, items, status, expected_at, delivered_at, email_id, is_private)
  values (e.organization_id, trim(p_order), coalesce(p_ordered, (e.received_at at time zone 'America/Los_Angeles')::date), nullif(trim(p_po), ''), v_po[1], v_po[2],
          v_who.person_name, p_total, left(p_items, 500),
          case p_kind when 'confirmation' then 'ordered' else p_kind end, p_expected,
          case when p_kind = 'delivered' then (e.received_at at time zone 'America/Los_Angeles')::date end, e.id, v_priv)
  on conflict (organization_id, order_number) do update set
    po = coalesce(amazon_orders.po, excluded.po), initials = coalesce(amazon_orders.initials, excluded.initials),
    store_code = coalesce(amazon_orders.store_code, excluded.store_code), person_name = coalesce(amazon_orders.person_name, excluded.person_name),
    total = coalesce(amazon_orders.total, excluded.total), items = coalesce(amazon_orders.items, excluded.items),
    ordered_at = least(amazon_orders.ordered_at, excluded.ordered_at),
    status = case when excluded.status = 'ordered' then amazon_orders.status else excluded.status end,
    expected_at = coalesce(excluded.expected_at, amazon_orders.expected_at),
    delivered_at = coalesce(excluded.delivered_at, amazon_orders.delivered_at),
    is_private = amazon_orders.is_private and excluded.is_private
  returning id into v_id;
  update public.emails set amazon_order_id = v_id where id = p_email;
  return v_id;
end;
$$;

-- Monthly spending, by store and by person (months back from now).
create or replace function public.amazon_monthly(p_org uuid, p_months integer default 12)
returns table (month date, store_code text, person_name text, orders bigint, total numeric)
language sql stable security definer set search_path = public as $$
  select date_trunc('month', a.ordered_at)::date, coalesce(a.store_code, 'No PO'), coalesce(a.person_name, case when a.initials is null then 'No PO' else a.initials end),
         count(*), coalesce(sum(a.total), 0)
    from public.amazon_orders a
   where a.organization_id = p_org and public.user_in_org(p_org) and (not a.is_private or public.is_admin())
     and a.status <> 'cancelled' and a.ordered_at >= (date_trunc('month', now()) - make_interval(months => p_months - 1))::date
   group by 1, 2, 3
   order by 1 desc, 2, 3
$$;

-- Supplies only look at an Amazon email once it is read, and never at Tyler's or Greg's orders.
create or replace function public.supply_confirmation_queue(p_org uuid, p_limit integer default 10)
returns table (email_id uuid, subject text, body_text text, sent_at timestamptz, from_name text, from_email text)
language sql stable security definer set search_path = public as $$
  select e.id, e.subject, left(coalesce(e.body_text, e.snippet), 2500), e.received_at, e.from_name, e.from_email
    from public.emails e
    left join public.email_senders s on s.id = e.sender_id
    left join public.mailboxes m on m.id = e.mailbox_id
   where e.organization_id = p_org and e.direction = 'in' and e.supply_conf_read_at is null and e.copy_of is null
     and (e.mailbox_id is null or m.owner_id = public.org_admin(p_org))
     and coalesce(s.kind, 'unknown') not in ('vendor', 'rep_group', 'carrier', 'internal')
     and coalesce(e.subject, '') ~* '(order|confirm|ship|deliver|arriv|receipt|purchase|track|package|dispatch)'
     and not (lower(e.from_email) like '%amazon.%' and e.amazon_read_at is null)
     and not exists (select 1 from public.amazon_orders a join public.po_initials pi on pi.organization_id = a.organization_id and pi.initials = a.initials
                      where a.id = e.amazon_order_id and not pi.goes_to_supplies)
     and e.received_at >= (select min(r.requested_at) - interval '1 day' from public.supply_requests r
                            where r.organization_id = p_org and r.status in ('requested', 'ordered'))
   order by e.received_at
   limit p_limit
$$;

revoke execute on function public.amazon_queue(uuid, integer), public.amazon_apply(uuid, text, text, text, numeric, text, date, date) from public, anon, authenticated;
grant execute on function public.amazon_queue(uuid, integer), public.amazon_apply(uuid, text, text, text, numeric, text, date, date) to service_role;
revoke execute on function public.amazon_monthly(uuid, integer) from public, anon;
grant execute on function public.amazon_monthly(uuid, integer), public.po_parse(text) to authenticated, service_role;
