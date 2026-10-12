-- 0094 — Primary and Promotions (Dana, Oct 12), like Outlook's Focused and Other. The two mail views keep their
-- stored names ('attention' = Primary, 'offers' = Promotions); what changes is how each email is sorted:
-- * Email by email: a vendor's promos go to Promotions while its rep's mail, confirmations and invoices stay
--   in Primary. Claude decides the ones the rules cannot.
-- * Moving a conversation teaches that kind of mail (newsletters, offers or regular mail) from that address,
--   not the whole company (mail_address_rules). A move in someone's own inbox teaches that inbox only.
-- * Senders marked Marketing (companies we have never bought from) always go to Promotions; "Other – not a
--   vendor" no longer keeps their newsletters and ads in Primary.
-- * Conversations we wrote in and order/invoice/shipping mail stay in Primary, unless it is a mass mailing
--   whose subject is an offer ("New arrivals that make a statement").

-- What kind of mail an email is, for address rules: a mass mailing, an offer, or regular mail.
create or replace function public.mail_email_kind(p_labels text[], p_subject text, p_is_bulk boolean)
returns text language sql immutable as $$
  select case
    when coalesce(p_is_bulk, false) or 'CATEGORY_PROMOTIONS' = any (coalesce(p_labels, '{}')) then 'bulk'
    when public.mail_is_offerish(p_subject) then 'offer'
    else 'regular'
  end
$$;

create table if not exists public.mail_address_rules (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  mailbox_id       uuid references public.mailboxes(id) on delete cascade,  -- null = every inbox
  address          text not null check (address = lower(address)),
  mail_kind        text not null check (mail_kind in ('bulk', 'offer', 'regular')),
  view             text not null check (view in ('attention', 'offers')),
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
comment on table public.mail_address_rules is 'Where one kind of mail from one address goes (Primary = attention, Promotions = offers), taught by moving a conversation. mailbox_id set = taught in that personal inbox and private to it.';
create unique index if not exists mail_address_rules_key on public.mail_address_rules (organization_id, coalesce(mailbox_id, '00000000-0000-0000-0000-000000000000'::uuid), address, mail_kind);
alter table public.mail_address_rules enable row level security;
drop policy if exists "mail_address_rules: members read" on public.mail_address_rules;
create policy "mail_address_rules: members read" on public.mail_address_rules for select to authenticated
  using (public.user_in_org(organization_id) and (mailbox_id is null or public.can_see_mailbox(mailbox_id)));
grant select on table public.mail_address_rules to authenticated;
grant all on table public.mail_address_rules to service_role;

-- One email's view. Returns {view, how}. p_addr_rule: the address rule for this kind of mail; p_rule: the
-- sender's rule (Marketing = offers, Other = attention); p_sender_kind: email_senders.kind.
drop function if exists public.mail_view_for(text, text[], text, text, boolean, text, boolean, text);
create or replace function public.mail_view_for(p_direction text, p_labels text[], p_subject text, p_is_bulk boolean,
  p_addr_rule text, p_rule text, p_sender_kind text, p_conversation boolean, p_ai_view text default null)
returns text[] language sql immutable as $$
  select case
    when p_direction <> 'in' then array['attention', 'signals']
    -- conversations we wrote in, and order/invoice/shipping mail that is not a mass-mailed offer
    when p_conversation then array['attention', 'signals']
    when public.mail_is_transactional(p_subject) and not (coalesce(p_is_bulk, false) and public.mail_is_offerish(p_subject)) then array['attention', 'signals']
    when p_addr_rule is not null then array[p_addr_rule, 'rule']
    when p_rule = 'offers' then array['offers', 'rule']
    when 'CATEGORY_PROMOTIONS' = any (coalesce(p_labels, '{}')) then array['offers', 'gmail']
    -- a rep's own mail, and mail from senders marked Other, stay in Primary unless mass-mailed
    when not coalesce(p_is_bulk, false) and (p_sender_kind = 'rep_group' or p_rule = 'attention') then array['attention', 'rule']
    when coalesce(p_is_bulk, false) then array['offers', 'signals']
    when public.mail_is_offerish(p_subject) then array['offers', 'signals']
    when p_ai_view is not null then array[p_ai_view, 'read']
    else array['attention', 'signals']
  end
$$;
grant execute on function public.mail_email_kind(text[], text, boolean), public.mail_view_for(text, text[], text, boolean, text, text, text, boolean, text) to authenticated, service_role;

-- The address rule for one email: its own inbox's rule first, then the one for every inbox.
create or replace function public.mail_address_rule(p_org uuid, p_mailbox uuid, p_from text, p_kind text)
returns text language sql stable security definer set search_path = public as $$
  select r.view from public.mail_address_rules r
   where r.organization_id = p_org and r.address = lower(p_from) and r.mail_kind = p_kind
     and (r.mailbox_id is null or r.mailbox_id = p_mailbox)
   order by r.mailbox_id is null
   limit 1
$$;
revoke execute on function public.mail_address_rule(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.mail_address_rule(uuid, uuid, text, text) to service_role;

create or replace function public.mail_classify(p_org uuid, p_ids uuid[] default null)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare v_changed integer;
begin
  with target as (
    select e.id,
           public.mail_view_for(e.direction, e.labels, e.subject, e.is_bulk,
             public.mail_address_rule(e.organization_id, e.mailbox_id, e.from_email, public.mail_email_kind(e.labels, e.subject, e.is_bulk)),
             s.view_rule, s.kind,
             exists (select 1 from public.emails o where o.thread_id = e.thread_id and o.direction = 'out'), e.ai_view) as vh
      from public.emails e left join public.email_senders s on s.id = e.sender_id
     where e.organization_id = p_org and (p_ids is null or e.id = any (p_ids)) and e.view_how is distinct from 'manual'
  ), upd as (
    update public.emails e set view = t.vh[1], view_how = t.vh[2]
      from target t where e.id = t.id and (e.view is distinct from t.vh[1] or e.view_how is distinct from t.vh[2])
    returning e.id, e.thread_id
  )
  select count(*) into v_changed from upd;

  -- A conversation is in Promotions only when nothing in it went out and every message that came in is a promotion.
  update public.email_threads th set view = x.v
    from (
      select t.id, case when bool_and(e.direction = 'in' and e.view = 'offers') filter (where e.direction <> 'internal') then 'offers' else 'attention' end as v
        from public.email_threads t join public.emails e on e.thread_id = t.id
       where t.organization_id = p_org
         and (p_ids is null or t.id in (select thread_id from public.emails where id = any (p_ids)))
       group by t.id
    ) x
   where th.id = x.id and th.view is distinct from x.v;
  return v_changed;
end;
$$;

-- Emails the rules leave unsure, for the sync to send to Claude (newest first). Service role only.
create or replace function public.mail_unsure_emails(p_org uuid, p_limit integer default 40)
returns table (id uuid, from_email text, from_name text, subject text, snippet text, body_text text, has_attachments boolean)
language sql stable security definer
set search_path = public
as $$
  select e.id, e.from_email, e.from_name, e.subject, e.snippet, left(e.body_text, 1500), e.has_attachments
    from public.emails e
    left join public.email_senders s on s.id = e.sender_id
   where e.organization_id = p_org and e.direction = 'in' and e.ai_read_at is null
     and e.view_how is distinct from 'manual'
     and e.is_bulk is not null
     and public.mail_view_for(e.direction, e.labels, e.subject, e.is_bulk,
           public.mail_address_rule(e.organization_id, e.mailbox_id, e.from_email, public.mail_email_kind(e.labels, e.subject, e.is_bulk)),
           s.view_rule, s.kind,
           exists (select 1 from public.emails o where o.thread_id = e.thread_id and o.direction = 'out'), null) = array['attention', 'signals']
   order by e.received_at desc
   limit p_limit
$$;

-- A person moves a conversation. Its incoming mail is marked by hand; with p_teach (the default) each address
-- in it learns the view for that kind of mail, and its other mail of that kind moves too. A move in someone's
-- own inbox teaches that inbox only. Returns how many other emails moved.
create or replace function public.set_email_thread_view(p_thread uuid, p_view text, p_teach boolean default true)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  t       public.email_threads%rowtype;
  v_ids   uuid[];
  v_moved integer := 0;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers sort mail'; end if;
  if p_view not in ('attention', 'offers') then raise exception 'Unknown view %', p_view; end if;
  select * into t from public.email_threads where id = p_thread;
  if not found or not public.user_in_org(t.organization_id)
     or not (t.mailbox_id is null or t.shared_at is not null or public.can_see_mailbox(t.mailbox_id)) then
    raise exception 'Conversation not found';
  end if;

  update public.emails set view = p_view, view_how = 'manual' where thread_id = p_thread and direction = 'in';
  update public.email_threads set view = p_view where id = p_thread;
  if p_teach then
    insert into public.mail_address_rules (organization_id, mailbox_id, address, mail_kind, view, created_by)
    select distinct t.organization_id, t.mailbox_id, lower(e.from_email), public.mail_email_kind(e.labels, e.subject, e.is_bulk), p_view, auth.uid()
      from public.emails e
     where e.thread_id = p_thread and e.direction = 'in' and coalesce(e.from_email, '') <> ''
    on conflict (organization_id, coalesce(mailbox_id, '00000000-0000-0000-0000-000000000000'::uuid), address, mail_kind)
    do update set view = excluded.view, created_by = excluded.created_by, created_at = now();

    select array_agg(o.id) into v_ids
      from public.emails o
     where o.organization_id = t.organization_id and o.thread_id <> p_thread and o.direction = 'in'
       and (t.mailbox_id is null or o.mailbox_id = t.mailbox_id)
       and lower(o.from_email) in (select lower(from_email) from public.emails where thread_id = p_thread and direction = 'in');
    if v_ids is not null then
      v_moved := public.mail_classify(t.organization_id, v_ids);
    end if;
  end if;
  return coalesce(v_moved, 0);
end;
$$;
revoke execute on function public.set_email_thread_view(uuid, text, boolean) from public, anon;
grant execute on function public.set_email_thread_view(uuid, text, boolean) to authenticated, service_role;

-- Re-sort the last 12 months (orders@ and every personal inbox) with the new rules. Emails moved by hand stay put.
select public.mail_classify(o.id, null) from public.organizations o where exists (select 1 from public.emails e where e.organization_id = o.id);
