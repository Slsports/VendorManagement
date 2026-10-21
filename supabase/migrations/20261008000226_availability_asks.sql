-- 0226 — Ask the rep what is discontinued (Dana, Oct 21): "from this page I need to be able to click on an 'email rep'
-- link and send this to them so I can have them check to see what has been discontinued and what we can still order.
-- When they reply, Claude marks those in our system so when we run this report again it tells us when we can no longer
-- order an item."
--
--   • availability_asks: one ask per email: the vendor, the sales report it came from, the items asked about (Vendor ID,
--     name, quantity), who asked, the email sent and its conversation, and what the rep answered.
--   • The email is sent by the person (gmail-send stamps the ask with the email and conversation).
--   • order-check (every minute) reads the rep's reply in that conversation with Claude: per item available /
--     discontinued / replaced (with what) / out of stock (back when) / unclear. Anything not available becomes an item
--     change with a Review card for the person who asked (Unavailable items, the same cards as from confirmations), so
--     nothing changes until a person decides; the decision goes to Lightspeed and every later report shows it. The card
--     links the rep's email.

set local lock_timeout = '5s';

create table if not exists public.availability_asks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  vendor_id        uuid not null references public.vendors(id) on delete cascade,
  sales_report_id  uuid references public.sales_reports(id) on delete set null,
  items            jsonb not null default '[]'::jsonb,   -- [{ vid, name, qty }]
  created_by       uuid references public.profiles(id) on delete set null,
  status           text not null default 'draft' check (status in ('draft', 'sent', 'read', 'failed')),
  email_id         uuid references public.emails(id) on delete set null,
  thread_id        uuid references public.email_threads(id) on delete set null,
  sent_at          timestamptz,
  reply_email_id   uuid references public.emails(id) on delete set null,
  answers          jsonb,                                 -- Claude's reading: [{ vid, name, status, … }]
  read_at          timestamptz,
  read_note        text,
  working_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
comment on table public.availability_asks is 'Emails asking a rep which items on a suggested order are discontinued or still available, and what the rep answered (read by Claude).';
create index if not exists availability_asks_vendor on public.availability_asks (organization_id, vendor_id, created_at desc);
create index if not exists availability_asks_waiting on public.availability_asks (thread_id) where status = 'sent';
alter table public.availability_asks enable row level security;
drop policy if exists "availability_asks: members read" on public.availability_asks;
create policy "availability_asks: members read" on public.availability_asks for select to authenticated using (public.user_in_org(organization_id));
grant select on public.availability_asks to authenticated;
grant all on public.availability_asks to service_role;
drop trigger if exists availability_asks_updated_at on public.availability_asks;
create trigger availability_asks_updated_at before update on public.availability_asks for each row execute function public.set_updated_at();

-- the rep's answers become item changes, like a confirmation's
alter table public.item_changes add column if not exists ask_id uuid references public.availability_asks(id) on delete cascade;
alter table public.item_changes drop constraint if exists item_changes_source_check;
alter table public.item_changes add constraint item_changes_source_check check (source in ('confirmation', 'report', 'rep_reply'));
create unique index if not exists item_changes_ask_item on public.item_changes (ask_id, item_key) where ask_id is not null;
comment on column public.item_changes.ask_id is 'The rep was asked by email (availability_asks) and answered this item is not available.';

/** A person starts an ask from the suggested order: the items, before the email is written. */
create or replace function public.availability_ask_create(p_vendor uuid, p_report uuid, p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_org uuid;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers ask reps' using errcode = '42501'; end if;
  select organization_id into v_org from public.vendors where id = p_vendor and public.user_in_org(organization_id);
  if v_org is null then raise exception 'Vendor not found' using errcode = '22023'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Which items?' using errcode = '22023'; end if;
  insert into public.availability_asks (organization_id, vendor_id, sales_report_id, items, created_by)
  values (v_org, p_vendor, p_report, p_items, auth.uid()) returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.availability_ask_create(uuid, uuid, jsonb) from public, anon;
grant execute on function public.availability_ask_create(uuid, uuid, jsonb) to authenticated, service_role;

/** gmail-send, after the email went: the ask waits for the rep's reply in that conversation. */
create or replace function public.availability_ask_sent(p_ask uuid, p_email uuid)
returns void language sql security definer set search_path = public as $$
  update public.availability_asks a set status = 'sent', email_id = e.id, thread_id = e.thread_id, sent_at = e.received_at
    from public.emails e
   where a.id = p_ask and e.id = p_email and e.organization_id = a.organization_id and a.status in ('draft', 'sent');
$$;
revoke execute on function public.availability_ask_sent(uuid, uuid) from public, anon, authenticated;
grant execute on function public.availability_ask_sent(uuid, uuid) to service_role;

/**
 * order-check: the next ask whose rep has replied (an email in from them in the conversation after ours) that no other
 * run is reading; claimed for 5 minutes.
 */
create or replace function public.availability_ask_next()
returns table (ask_id uuid, organization_id uuid, vendor_id uuid, vendor_name text, items jsonb, thread_id uuid, sent_at timestamptz, created_by uuid)
language plpgsql security definer set search_path = public as $$
declare a public.availability_asks%rowtype;
begin
  select x.* into a from public.availability_asks x
   where x.status = 'sent' and (x.working_at is null or x.working_at < now() - interval '5 minutes')
     and exists (select 1 from public.emails e where e.thread_id = x.thread_id and e.direction = 'in' and e.received_at > x.sent_at)
   order by x.sent_at limit 1 for update skip locked;
  if a.id is null then return; end if;
  update public.availability_asks set working_at = now() where id = a.id;
  return query select a.id, a.organization_id, a.vendor_id, v.name, a.items, a.thread_id, a.sent_at, a.created_by
    from public.vendors v where v.id = a.vendor_id;
end;
$$;
revoke execute on function public.availability_ask_next() from public, anon, authenticated;
grant execute on function public.availability_ask_next() to service_role;

/**
 * The rep's answer, read by Claude (service role). Every answer is kept on the ask; each item not available becomes an
 * item change with a Review card for the person who asked (a re-read never changes a decision already made).
 */
create or replace function public.availability_ask_read(p_ask uuid, p_reply uuid, p_answers jsonb, p_note text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  a   public.availability_asks%rowtype;
  v   public.vendors%rowtype;
  it  jsonb;
  k   text;
  ch  public.item_changes%rowtype;
  li_id text; li_name text;
  rid uuid;
  n   integer := 0;
begin
  select * into a from public.availability_asks where id = p_ask;
  if not found then return 0; end if;
  select * into v from public.vendors where id = a.vendor_id;
  update public.availability_asks set status = 'read', reply_email_id = p_reply, answers = coalesce(p_answers, '[]'::jsonb),
         read_at = now(), read_note = left(p_note, 300), working_at = null where id = a.id;
  for it in select * from jsonb_array_elements(coalesce(p_answers, '[]'::jsonb)) loop
    if coalesce(it->>'status', '') not in ('discontinued', 'replaced', 'out_of_stock', 'unclear') then continue; end if;
    k := upper(coalesce(nullif(trim(it->>'vid'), ''), left(trim(coalesce(it->>'name', '')), 80)));
    if k = '' then continue; end if;
    li_id := null; li_name := null;
    if v.lightspeed_vendor_id is not null and nullif(trim(it->>'vid'), '') is not null then
      select i.item_id, i.description into li_id, li_name from public.ls_items i
       where i.organization_id = a.organization_id and i.default_vendor_id = v.lightspeed_vendor_id and upper(i.vendor_item_id) = upper(trim(it->>'vid'))
       order by i.archived, i.item_id limit 1;
    end if;
    insert into public.item_changes (organization_id, vendor_id, ask_id, source, item_key, vendor_item_id, item_name, read_as, sure,
                                     replacement_vendor_item_id, replacement_name, back_date, vendor_words, ls_item_id, ls_name)
    values (a.organization_id, a.vendor_id, a.id, 'rep_reply', k, nullif(trim(it->>'vid'), ''), nullif(trim(it->>'name'), ''),
            it->>'status', coalesce((it->>'sure')::boolean, false), nullif(trim(it->>'replacement_vid'), ''), nullif(trim(it->>'replacement_name'), ''),
            case when it->>'back_date' ~ '^\d{4}-\d{2}-\d{2}$' then (it->>'back_date')::date end,
            left(nullif(trim(it->>'rep_words'), ''), 500), li_id, li_name)
    on conflict (ask_id, item_key) where ask_id is not null do update set
      read_as = excluded.read_as, sure = excluded.sure, replacement_vendor_item_id = excluded.replacement_vendor_item_id,
      replacement_name = excluded.replacement_name, back_date = excluded.back_date, vendor_words = excluded.vendor_words
     where item_changes.decision is null
    returning * into ch;
    if ch.id is null then continue; end if;
    n := n + 1;
    if ch.review_item_id is null and ch.decision is null then
      insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details, assigned_to, assigned_at)
      values (a.organization_id, 'item_change', 'vendor', a.vendor_id,
              format('%s: %s %s (the rep says)', coalesce(v.name, 'Vendor'), coalesce(ch.vendor_item_id || ' ', ''),
                     case ch.read_as when 'replaced' then 'replaced' when 'discontinued' then 'discontinued'
                                     when 'out_of_stock' then 'out of stock' else 'may not be available' end),
              jsonb_build_object('change_id', ch.id, 'ask_id', a.id, 'reply_email_id', p_reply, 'thread_id', a.thread_id,
                                 'vendor_id', a.vendor_id, 'vendor_name', v.name, 'vendor_id_for_rules', a.vendor_id),
              a.created_by, case when a.created_by is not null then now() end)
      returning id into rid;
      update public.item_changes set review_item_id = rid where id = ch.id;
    end if;
    ch := null;
  end loop;
  return n;
end;
$$;
revoke execute on function public.availability_ask_read(uuid, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.availability_ask_read(uuid, uuid, jsonb, text) to service_role;
