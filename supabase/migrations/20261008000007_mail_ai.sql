-- 0028 — Claude reads what the rules cannot (Dana created the API key, Oct 8). Three uses, all on the
-- cheapest model and all logged with their cost:
-- 1. Emails the sorting rules leave unsure get a short read: Needs attention or Offers & catalogs. The
--    answer is the last step before "unsure stays in Needs attention"; a person's move and a taught
--    sender still win.
-- 2. "Who is this mail from?" cards with no guess get Claude's reading of a few of the sender's emails:
--    a vendor from our list, a rep group, a service that sends for many vendors, or not a vendor. It is a
--    suggestion on the card; nothing files itself.
-- 3. Every call is logged in ai_usage (tokens and cost) for Settings > Mail.

create table if not exists public.ai_usage (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  purpose          text not null,                -- mail_sort, sender_guess, …
  model            text not null,
  input_tokens     integer not null default 0,
  output_tokens    integer not null default 0,
  cost_usd         numeric(10,5) not null default 0,
  items            integer not null default 1,   -- emails or senders handled by the call
  created_at       timestamptz not null default now()
);
comment on table public.ai_usage is 'Every Claude API call: what for, which model, tokens and cost (spec §8 cost tracking).';
create index if not exists ai_usage_org_idx on public.ai_usage (organization_id, created_at desc);
alter table public.ai_usage enable row level security;
drop policy if exists "ai_usage: members read" on public.ai_usage;
create policy "ai_usage: members read" on public.ai_usage for select to authenticated using (public.user_in_org(organization_id));
grant select on table public.ai_usage to authenticated;
grant all on table public.ai_usage to service_role;

alter table public.emails add column if not exists ai_view text check (ai_view in ('attention', 'offers'));
alter table public.emails add column if not exists ai_read_at timestamptz;
alter table public.email_senders add column if not exists ai_kind text check (ai_kind in ('vendor', 'rep_group', 'platform', 'not_vendor', 'unsure'));
alter table public.email_senders add column if not exists ai_vendor_id uuid references public.vendors(id) on delete set null;
alter table public.email_senders add column if not exists ai_note text;
alter table public.email_senders add column if not exists ai_read_at timestamptz;

-- The view rules with Claude's reading as the last word before "unsure".
drop function if exists public.mail_view_for(text, text[], text, text, boolean, text, boolean);
create or replace function public.mail_view_for(p_direction text, p_labels text[], p_subject text, p_from text, p_is_bulk boolean, p_rule text, p_conversation boolean, p_ai_view text default null)
returns text[] language sql immutable as $$
  select case
    when p_direction <> 'in' then array['attention', 'signals']
    when p_rule is not null then array[p_rule, 'rule']
    when p_conversation then array['attention', 'signals']
    when public.mail_is_transactional(p_subject) then array['attention', 'signals']
    when 'CATEGORY_PROMOTIONS' = any (p_labels) then array['offers', 'gmail']
    when coalesce(p_is_bulk, false) then array['offers', 'signals']
    when public.mail_is_offerish(p_subject) then array['offers', 'signals']
    when p_ai_view is not null then array[p_ai_view, 'read']
    else array['attention', 'signals']
  end
$$;
grant execute on function public.mail_view_for(text, text[], text, text, boolean, text, boolean, text) to authenticated, service_role;

create or replace function public.mail_classify(p_org uuid, p_ids uuid[] default null)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare v_changed integer;
begin
  with target as (
    select e.id,
           public.mail_view_for(e.direction, e.labels, e.subject, e.from_email, e.is_bulk, s.view_rule,
             exists (select 1 from public.emails o where o.thread_id = e.thread_id and o.direction = 'out'), e.ai_view) as vh
      from public.emails e left join public.email_senders s on s.id = e.sender_id
     where e.organization_id = p_org and (p_ids is null or e.id = any (p_ids)) and e.view_how is distinct from 'manual'
  ), upd as (
    update public.emails e set view = t.vh[1], view_how = t.vh[2]
      from target t where e.id = t.id and (e.view is distinct from t.vh[1] or e.view_how is distinct from t.vh[2])
    returning e.id, e.thread_id
  )
  select count(*) into v_changed from upd;

  -- A conversation is an offer only when nothing in it went out and every message that came in is an offer.
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

create or replace function public.mail_refresh_sender(p_sender uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  s        public.email_senders%rowtype;
  v_count  integer;
  v_best   uuid;
  v_ment   integer;
  v_dom    boolean;
  v_name   text;
  v_note   text;
  v_title  text;
  v_det    jsonb;
  v_item   uuid;
begin
  select * into s from public.email_senders where id = p_sender for update;
  if not found then return; end if;
  select count(*) into v_count from public.emails where sender_id = p_sender;
  update public.email_senders set message_count = v_count, last_seen_at = (select max(received_at) from public.emails where sender_id = p_sender) where id = p_sender;
  if s.kind <> 'unknown' then return; end if;

  -- Score each candidate: one point per email naming it, plus a domain that looks like its name.
  with ments as (
    select unnest(mentioned_vendor_ids) as vid from public.emails where sender_id = p_sender
  ), cand as (
    select vid, count(*)::integer as m from ments group by vid
    union all
    select unnest(s.domain_vendor_ids), 0
  )
  select c.vid, sum(c.m)::integer, bool_or(c.vid = any (s.domain_vendor_ids))
    into v_best, v_ment, v_dom
    from cand c join public.vendors v on v.id = c.vid and v.is_active
   group by c.vid
   order by sum(c.m) + case when bool_or(c.vid = any (s.domain_vendor_ids)) then greatest(2, v_count * 0.5) else 0 end desc, sum(c.m) desc
   limit 1;

  -- A passing mention is not a proposal: it takes the web address, or a name in at least two emails and
  -- in at least three in ten of them ("named in 1 of 19" stays a plain "which vendor?").
  if v_best is not null and not v_dom and (v_ment < 2 or v_ment < v_count * 0.3) then
    v_best := null; v_ment := 0;
  end if;
  -- Nothing in the mail itself pointed anywhere: use what Claude read, when it named a vendor we have.
  if v_best is null and s.ai_kind = 'vendor' and s.ai_vendor_id is not null
     and exists (select 1 from public.vendors where id = s.ai_vendor_id and is_active) then
    v_best := s.ai_vendor_id;
    select name into v_name from public.vendors where id = v_best;
    v_note := 'Claude read the mail: ' || coalesce(s.ai_note, 'it names this vendor');
  elsif v_best is not null then
    select name into v_name from public.vendors where id = v_best;
    v_note := concat_ws('; ',
      case when v_ment > 0 then format('named in %s of %s emails', v_ment, v_count) end,
      case when v_dom then 'the web address looks like the name' end);
  end if;
  update public.email_senders set proposed_vendor_id = v_best, proposal_note = v_note where id = p_sender;

  v_title := case when v_best is not null
    then format('Mail from %s%s looks like %s', case when s.is_domain then '@' else '' end, s.sender_key, v_name)
    else format('Mail from %s%s: which vendor?', case when s.is_domain then '@' else '' end, s.sender_key) end;
  v_det := jsonb_build_object(
    'sender_id', s.id, 'sender_key', s.sender_key, 'is_domain', s.is_domain, 'display_name', s.display_name,
    'message_count', v_count, 'proposed_vendor_id', v_best, 'proposed_vendor_name', v_name, 'proposal_note', v_note,
    'vendor_id', v_best,  -- lets the assignment rules route it (fishing vendors to Jarrett)
    'ai_kind', s.ai_kind, 'ai_note', s.ai_note,
    'samples', (select coalesce(jsonb_agg(x.subject), '[]'::jsonb) from (select subject from public.emails where sender_id = p_sender and subject is not null order by received_at desc limit 3) x)
  );

  select id into v_item from public.review_items where id = s.review_item_id and status = 'pending';
  if v_item is null then
    insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
    values (s.organization_id, 'email_sender', 'email_sender', s.id, v_title, v_det) returning id into v_item;
    update public.email_senders set review_item_id = v_item where id = p_sender;
  else
    update public.review_items set title = v_title, details = v_det where id = v_item;
  end if;
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
     and e.view_how is distinct from 'manual' and s.view_rule is null
     and e.is_bulk is not null
     and public.mail_view_for(e.direction, e.labels, e.subject, e.from_email, e.is_bulk, null,
           exists (select 1 from public.emails o where o.thread_id = e.thread_id and o.direction = 'out'), null) = array['attention', 'signals']
   order by e.received_at desc
   limit p_limit
$$;

-- Store Claude's views and re-sort those emails.
create or replace function public.mail_set_ai_views(p_org uuid, p_ids uuid[], p_views text[])
returns integer
language plpgsql security definer
set search_path = public
as $$
begin
  update public.emails e set ai_view = nullif(x.v, 'unsure'), ai_read_at = now()
    from unnest(p_ids, p_views) as x(id, v)
   where e.id = x.id and e.organization_id = p_org;
  return public.mail_classify(p_org, p_ids);
end;
$$;

-- Store Claude's reading of a sender and refresh its review card.
create or replace function public.mail_set_sender_ai(p_sender uuid, p_kind text, p_vendor uuid, p_note text)
returns void
language plpgsql security definer
set search_path = public
as $$
begin
  update public.email_senders set ai_kind = p_kind, ai_vendor_id = p_vendor, ai_note = left(p_note, 300), ai_read_at = now() where id = p_sender;
  perform public.mail_refresh_sender(p_sender);
end;
$$;

revoke execute on function public.mail_unsure_emails(uuid, integer), public.mail_set_ai_views(uuid, uuid[], text[]), public.mail_set_sender_ai(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function public.mail_unsure_emails(uuid, integer), public.mail_set_ai_views(uuid, uuid[], text[]), public.mail_set_sender_ai(uuid, text, uuid, text) to service_role;
