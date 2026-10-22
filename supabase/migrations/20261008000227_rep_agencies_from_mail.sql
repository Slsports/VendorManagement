-- 0227 — Rep agencies from the mail, and another name re-checks the old (Dana, Oct 21): "Why are there 33 emails from Jeff
-- Turner, Turner Group (Rep Group), his contact info is in the emails and it was not saved to the Rep Groups and only
-- 'suggested' that one of the vendors he reps for is spin copter then there were clearly other companies listed in his
-- emails? Same with Toyology and Patti Johansens emails … And when I go into a vendor and add an alias, it should go
-- recheck anything that has a review flag to see if it can match it up."
--
--   • Claude's sort of a "Who is this?" sender keeps a rep agency that is not in Rep Groups (its company, website, phone
--     and the people from the signatures) and an order system that sends for many vendors (MarketTime). The card then
--     offers New rep group / A service for many vendors; a person decides.
--   • The card lists every vendor the sender's mail names, with how many emails name it. A sender whose mail names two
--     or more vendors often is no longer guessed as the one named most.
--   • rep_group_from_sender: one click makes the rep group with its people, links the lines, files the sender, tags every
--     email to each vendor it names; lines with another rep group become cards.
--   • A "vendor_alias" card asks whether a name saved on a vendor belongs there (TOYOLOGY on Blokees is the rep agency).
--   • vendor_name_checks: adding (or removing) a vendor's name or alias queues a re-check that gmail-sync runs: old mail
--     that names it (or only named it by the removed name), "Who is this?" cards and rep line cards. The counts show
--     on the vendor page.

set local lock_timeout = '5s';

alter table public.email_senders add column if not exists rep_contacts jsonb;
comment on column public.email_senders.rep_contacts is 'People Claude read from the signatures of a rep agency''s mail: [{name, email, phone, title}].';

-- ---- what Claude read about a sender -------------------------------------------------------------------------------
drop function if exists public.mail_apply_sender_sort(uuid, text, uuid, text, text, text, text);
create or replace function public.mail_apply_sender_sort(p_sender uuid, p_decision text, p_vendor uuid, p_company text, p_website text, p_phone text, p_note text, p_people jsonb default null)
returns text
language plpgsql security definer
set search_path = public
as $$
declare s public.email_senders%rowtype;
begin
  select * into s from public.email_senders where id = p_sender for update;
  if not found then return 'gone'; end if;
  update public.email_senders set company_name = coalesce(nullif(trim(p_company), ''), company_name),
    company_website = coalesce(nullif(trim(p_website), ''), company_website), company_phone = coalesce(nullif(trim(p_phone), ''), company_phone),
    rep_contacts = case when jsonb_typeof(p_people) = 'array' and jsonb_array_length(p_people) > 0 then p_people else rep_contacts end,
    sorted_at = now(), sort_note = left(p_note, 300)
   where id = p_sender;
  if s.kind <> 'unknown' then return 'info'; end if;

  if p_decision = 'vendor' and p_vendor is not null
     and exists (select 1 from public.vendors where id = p_vendor and organization_id = s.organization_id and is_active and merged_into_id is null) then
    perform public.mail_file_sender(p_sender, p_vendor, 'claude', p_note, null);
    return 'filed';
  elsif p_decision = 'carrier' then
    perform public.mail_sender_to_freight(p_sender, coalesce(nullif(trim(p_company), ''), s.display_name, s.sender_key));
    return 'carrier';
  elsif p_decision = 'never_bought' then
    update public.email_senders set kind = 'marketing', view_rule = 'offers', decided_at = now() where id = p_sender;
    update public.review_items set status = 'rejected', resolved_at = now(), resolution_note = 'Never bought from (Claude)'
     where id = s.review_item_id and status = 'pending';
    perform public.mail_classify(s.organization_id, (select array_agg(id) from public.emails where sender_id = p_sender));
    return 'never_bought';
  end if;
  -- a rep agency not in Rep Groups, or a service for many vendors: the card says so; a person decides
  update public.email_senders set ai_note = coalesce(left(p_note, 300), ai_note), ai_read_at = coalesce(ai_read_at, now()),
         ai_kind = case p_decision when 'rep_group' then 'rep_group' when 'platform' then 'platform' else ai_kind end
   where id = p_sender;
  perform public.mail_refresh_sender(p_sender);
  return 'unsure';
end;
$$;
revoke execute on function public.mail_apply_sender_sort(uuid, text, uuid, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.mail_apply_sender_sort(uuid, text, uuid, text, text, text, text, jsonb) to service_role;

-- ---- the "Who is this?" card: every vendor the mail names -----------------------------------------------------------
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
  v_named  jsonb;
  v_often  integer;
  v_second integer;
  v_key    text;
begin
  select * into s from public.email_senders where id = p_sender for update;
  if not found then return; end if;
  select count(*) into v_count from public.emails where sender_id = p_sender;
  update public.email_senders set message_count = v_count, last_seen_at = (select max(received_at) from public.emails where sender_id = p_sender) where id = p_sender;
  if s.kind <> 'unknown' then return; end if;
  -- Every email from them is filed or handled one by one: nothing to ask until new mail comes.
  if not exists (select 1 from public.emails where sender_id = p_sender and vendor_id is null and disposition is null) then return; end if;
  -- Someone we have not heard from in a year (mail read in from history): no "which vendor?" card (Dana, Oct 19).
  if (select max(received_at) from public.emails where sender_id = p_sender) < now() - interval '12 months' then return; end if;
  v_key := case when s.is_domain then '@' else '' end || s.sender_key;

  -- Every vendor the shared mail names, most named first (Dana, Oct 21: Turner Group names six of our vendors).
  select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'n', x.n, 'rep_group', g.name) order by x.n desc, v.name), '[]'::jsonb)
    into v_named
    from (select m.vid, count(*)::integer as n from public.emails e cross join unnest(e.mentioned_vendor_ids) m(vid)
           where e.sender_id = p_sender
             and (e.mailbox_id is null or exists (select 1 from public.email_threads t where t.id = e.thread_id and t.shared_at is not null))
           group by m.vid order by count(*) desc limit 20) x
    join public.vendors v on v.id = x.vid and v.is_active and v.merged_into_id is null
    left join public.rep_groups g on g.id = v.rep_group_id;
  select count(*) filter (where (j->>'n')::int >= 2) into v_often from jsonb_array_elements(v_named) j;
  v_second := coalesce((v_named->1->>'n')::int, 0);

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
  -- Mail that names two or more vendors often is a rep or a service, not the one named most.
  if v_best is not null and not v_dom and v_second >= greatest(2, ceil(v_count * 0.15)) then
    v_best := null; v_ment := 0;
  end if;
  -- Nothing in the mail itself pointed anywhere: use what Claude read, when it named a vendor we have.
  if v_best is null and v_often < 2 and s.ai_kind = 'vendor' and s.ai_vendor_id is not null
     and exists (select 1 from public.vendors where id = s.ai_vendor_id and is_active) then
    v_best := s.ai_vendor_id;
    select name into v_name from public.vendors where id = v_best;
    v_note := 'Claude read the mail: ' || coalesce(s.ai_note, 'it names this vendor');
  elsif v_best is not null then
    select name into v_name from public.vendors where id = v_best;
    v_note := concat_ws('; ',
      case when v_ment > 0 then format('named in %s of %s emails', v_ment, v_count) end,
      case when v_dom then 'the web address looks like the name' end);
  elsif v_often >= 2 then
    v_note := format('their mail names %s of our vendors', v_often);
  end if;
  update public.email_senders set proposed_vendor_id = v_best, proposal_note = v_note where id = p_sender;

  v_title := case
    when v_best is not null then format('Mail from %s looks like %s', v_key, v_name)
    when s.ai_kind = 'rep_group' and s.company_name is not null then format('Mail from %s: %s, a rep agency not in Rep Groups yet', v_key, s.company_name)
    when s.ai_kind = 'platform' then format('Mail from %s: %s sends for many vendors', v_key, coalesce(s.company_name, s.sender_key))
    when v_often >= 2 then format('Mail from %s names %s of our vendors', v_key, v_often)
    else format('Mail from %s: which vendor?', v_key) end;
  v_det := jsonb_build_object(
    'sender_id', s.id, 'sender_key', s.sender_key, 'is_domain', s.is_domain, 'display_name', s.display_name,
    'message_count', v_count, 'proposed_vendor_id', v_best, 'proposed_vendor_name', v_name, 'proposal_note', v_note,
    'vendor_id', v_best,  -- lets the assignment rules route it (fishing vendors to Jarrett)
    'ai_kind', s.ai_kind, 'ai_note', s.ai_note,
    'named_vendors', v_named,
    'company', s.company_name, 'website', s.company_website, 'phone', s.company_phone, 'rep_contacts', coalesce(s.rep_contacts, '[]'::jsonb),
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

-- ---- New rep group from a "Who is this?" card ----------------------------------------------------------------------
create or replace function public.rep_group_from_sender(p_sender uuid, p_name text, p_website text, p_phone text, p_contacts jsonb, p_vendors uuid[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s        public.email_senders%rowtype;
  v_group  uuid;
  v_new    boolean := false;
  c        jsonb;
  v_people integer := 0;
  v_linked integer;
  v_lines  jsonb;
  v_tags   integer := 0;
  r        record;
  v_first  jsonb;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers add rep groups' using errcode = '42501'; end if;
  select * into s from public.email_senders where id = p_sender;
  if not found or not public.user_in_org(s.organization_id) then raise exception 'Sender not found' using errcode = '23503'; end if;
  if nullif(trim(p_name), '') is null then raise exception 'Name the rep group' using errcode = '22023'; end if;
  if exists (select 1 from unnest(coalesce(p_vendors, '{}')) x where not exists (select 1 from public.vendors where id = x and organization_id = s.organization_id)) then
    raise exception 'Vendor not found' using errcode = '23503';
  end if;

  -- the same name already in Rep Groups is that group, never a second copy
  select id into v_group from public.rep_groups
   where organization_id = s.organization_id and lower(trim(name)) = lower(trim(p_name)) order by is_active desc, created_at limit 1;
  if jsonb_typeof(p_contacts) = 'array' then v_first := p_contacts->0; end if;
  if v_group is null then
    insert into public.rep_groups (organization_id, name, website, phone, email, contact_name)
    values (s.organization_id, trim(p_name), nullif(trim(p_website), ''), nullif(trim(p_phone), ''),
            nullif(lower(trim(v_first->>'email')), ''), nullif(trim(v_first->>'name'), ''))
    returning id into v_group;
    v_new := true;
  else
    update public.rep_groups set is_active = true, website = coalesce(website, nullif(trim(p_website), '')), phone = coalesce(phone, nullif(trim(p_phone), ''))
     where id = v_group;
  end if;

  for c in select * from jsonb_array_elements(case when jsonb_typeof(p_contacts) = 'array' then p_contacts else '[]'::jsonb end) loop
    continue when nullif(trim(c->>'name'), '') is null and nullif(trim(c->>'email'), '') is null;
    continue when exists (select 1 from public.rep_group_contacts x where x.rep_group_id = v_group
                           and ((nullif(trim(c->>'email'), '') is not null and lower(x.email) = lower(trim(c->>'email')))
                                or (nullif(trim(c->>'email'), '') is null and lower(x.name) = lower(trim(c->>'name')))));
    insert into public.rep_group_contacts (organization_id, rep_group_id, name, title, email, phone)
    values (s.organization_id, v_group, nullif(trim(c->>'name'), ''), nullif(trim(c->>'title'), ''), nullif(lower(trim(c->>'email')), ''), nullif(trim(c->>'phone'), ''));
    v_people := v_people + 1;
  end loop;

  v_linked := public.resolve_email_sender(p_sender, 'rep_group', null, v_group);
  -- lines with no rep group join it; a line with another rep group becomes a card
  v_lines := public.rep_group_apply_lines(p_sender, coalesce(p_vendors, '{}'), '{}');
  -- Claude still reads the mail for lines that are not vendors yet (cards)
  update public.email_senders set rep_lines_read_at = null where id = p_sender;
  -- every email, filed or not, is tagged to each vendor it names
  for r in select id from public.emails where sender_id = p_sender loop
    perform public.mail_auto_tag(r.id);
  end loop;
  select count(distinct g.email_id) into v_tags from public.email_vendor_tags g join public.emails e on e.id = g.email_id where e.sender_id = p_sender;
  insert into public.activity_log (organization_id, entity_type, entity_id, action, details, actor_id)
  values (s.organization_id, 'rep_group', v_group, case when v_new then 'created_from_mail' else 'sender_added' end,
          jsonb_build_object('sender', s.sender_key, 'people', v_people, 'lines', v_lines), auth.uid());
  return jsonb_build_object('rep_group_id', v_group, 'created', v_new, 'people', v_people, 'linked', v_linked,
                            'lines_added', coalesce(v_lines->'added', '[]'::jsonb), 'asked', coalesce((v_lines->>'asked')::int, 0), 'tagged', v_tags);
end;
$$;
revoke execute on function public.rep_group_from_sender(uuid, text, text, text, jsonb, uuid[]) from public, anon;
grant execute on function public.rep_group_from_sender(uuid, text, text, text, jsonb, uuid[]) to authenticated;

-- ---- "Does this name belong on this vendor?" ----------------------------------------------------------------------
create or replace function public.vendor_alias_answer(p_item uuid, p_remove boolean)
returns void
language plpgsql security definer set search_path = public as $$
declare r public.review_items%rowtype; v_alias text;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers change vendor names' using errcode = '42501'; end if;
  select * into r from public.review_items where id = p_item for update;
  if not found or not public.user_in_org(r.organization_id) or r.kind <> 'vendor_alias' then raise exception 'Card not found' using errcode = '23503'; end if;
  if r.status <> 'pending' then return; end if;
  v_alias := r.details->>'alias';
  if p_remove then
    update public.vendors set aliases = array(select a from unnest(aliases) a where lower(trim(a)) <> lower(trim(v_alias)))
     where id = (r.details->>'vendor_id')::uuid and organization_id = r.organization_id;
  end if;
  update public.review_items set status = case when p_remove then 'accepted'::public.review_status else 'rejected'::public.review_status end,
         resolved_by = auth.uid(), resolved_at = now(),
         resolution_note = case when p_remove then format('Removed "%s" from %s', v_alias, r.details->>'vendor_name') else format('Kept "%s" on %s', v_alias, r.details->>'vendor_name') end
   where id = p_item;
end;
$$;
revoke execute on function public.vendor_alias_answer(uuid, boolean) from public, anon;
grant execute on function public.vendor_alias_answer(uuid, boolean) to authenticated;

-- TOYOLOGY is saved as another name for Blokees, but Toyology is the rep agency (Patti Johansen, Sally Brennan).
do $$
declare v record;
begin
  for v in select x.id, x.name, x.organization_id, a from public.vendors x cross join unnest(x.aliases) a
            where upper(trim(a)) = 'TOYOLOGY' and x.merged_into_id is null loop
    if not exists (select 1 from public.review_items where kind = 'vendor_alias' and entity_id = v.id and lower(details->>'alias') = lower(v.a)) then
      insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
      values (v.organization_id, 'vendor_alias', 'vendor', v.id, format('"%s" is saved as another name for %s. Remove it?', v.a, v.name),
              jsonb_build_object('vendor_id', v.id, 'vendor_name', v.name, 'alias', v.a, 'vendor_id_for_rules', v.id,
                                 'why', 'Toyology is a rep agency (Patti Johansen, Sally Brennan) for Blokees, Thin Air, Schylling and Water Sports. As another name for Blokees, mail that says "Toyology" is taken to be about Blokees.'));
    end if;
  end loop;
end $$;

-- ---- another name re-checks the old ------------------------------------------------------------------------------
create table if not exists public.vendor_name_checks (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  vendor_id        uuid not null references public.vendors(id) on delete cascade,
  added            text[] not null default '{}',
  removed          text[] not null default '{}',
  requested_by     uuid references public.profiles(id) on delete set null,
  status           text not null default 'waiting' check (status in ('waiting', 'working', 'done', 'failed')),
  working_at       timestamptz,
  emails_named     integer not null default 0,
  emails_unnamed   integer not null default 0,
  emails_tagged    integer not null default 0,
  cards_updated    integer not null default 0,
  note             text,
  created_at       timestamptz not null default now(),
  done_at          timestamptz
);
comment on table public.vendor_name_checks is 'A vendor''s name or alias was added or removed: the old mail and open review cards are re-checked for it (gmail-sync), with counts.';
create index if not exists vendor_name_checks_vendor on public.vendor_name_checks (vendor_id, created_at desc);
create index if not exists vendor_name_checks_waiting on public.vendor_name_checks (created_at) where status in ('waiting', 'working');
alter table public.vendor_name_checks enable row level security;
drop policy if exists "vendor_name_checks: members read" on public.vendor_name_checks;
create policy "vendor_name_checks: members read" on public.vendor_name_checks for select to authenticated using (public.user_in_org(organization_id));
grant select on public.vendor_name_checks to authenticated;
grant all on public.vendor_name_checks to service_role;

create or replace function public.vendors_name_check() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_new     text[] := array(select trim(x) from unnest(array[new.name] || coalesce(new.aliases, '{}')) x where trim(coalesce(x, '')) <> '');
  v_old     text[] := case when tg_op = 'UPDATE' then array(select trim(x) from unnest(array[old.name] || coalesce(old.aliases, '{}')) x where trim(coalesce(x, '')) <> '') else '{}' end;
  v_added   text[];
  v_removed text[];
begin
  if new.merged_into_id is not null then return null; end if;
  v_added := array(select distinct x from unnest(v_new) x where lower(x) <> all (select lower(y) from unnest(v_old) y));
  v_removed := array(select distinct x from unnest(v_old) x where lower(x) <> all (select lower(y) from unnest(v_new) y));
  if cardinality(v_added) = 0 and cardinality(v_removed) = 0 then return null; end if;
  insert into public.vendor_name_checks (organization_id, vendor_id, added, removed, requested_by)
  values (new.organization_id, new.id, v_added, v_removed, auth.uid());
  return null;
end;
$$;
revoke execute on function public.vendors_name_check() from public, anon, authenticated;
drop trigger if exists vendors_name_check on public.vendors;
create trigger vendors_name_check after insert or update of name, aliases on public.vendors for each row execute function public.vendors_name_check();

/** gmail-sync: the next re-check, claimed for 5 minutes. */
create or replace function public.vendor_name_check_next(p_org uuid)
returns table (check_id uuid, vendor_id uuid, vendor_name text, aliases text[], added text[], removed text[])
language plpgsql security definer set search_path = public as $$
declare c public.vendor_name_checks%rowtype;
begin
  select * into c from public.vendor_name_checks x
   where x.organization_id = p_org and (x.status = 'waiting' or (x.status = 'working' and x.working_at < now() - interval '5 minutes'))
   order by x.created_at limit 1 for update skip locked;
  if c.id is null then return; end if;
  update public.vendor_name_checks set status = 'working', working_at = now() where id = c.id;
  return query select c.id, v.id, v.name, v.aliases, c.added, c.removed from public.vendors v where v.id = c.vendor_id;
end;
$$;
revoke execute on function public.vendor_name_check_next(uuid) from public, anon, authenticated;
grant execute on function public.vendor_name_check_next(uuid) to service_role;

/**
 * Emails whose text has the phrase (the search index: subject, people, body; or an attachment's file name), after
 * p_after by id. p_named: only emails already naming the vendor (a removed name), else only those not naming it yet.
 */
create or replace function public.vendor_name_check_emails(p_org uuid, p_vendor uuid, p_phrase text, p_named boolean, p_after uuid default null, p_limit integer default 300)
returns table (id uuid, subject text, body_text text, from_name text, files text[])
language sql stable security definer set search_path = public as $$
  with hits as (
    select e.id from public.emails e
     where e.organization_id = p_org and e.search @@ phraseto_tsquery('simple', p_phrase)
    union
    select a.email_id from public.email_attachments a
     where a.organization_id = p_org and a.file_name ilike '%' || replace(replace(p_phrase, '%', ''), ' ', '%') || '%'
  )
  select e.id, e.subject, left(coalesce(nullif(e.body_text, ''), e.snippet, ''), 20000), e.from_name,
         coalesce((select array_agg(a.file_name) from public.email_attachments a where a.email_id = e.id), '{}')
    from public.emails e join hits h on h.id = e.id
   where (p_after is null or e.id > p_after)
     and (case when p_named then p_vendor = any (e.mentioned_vendor_ids) else not (p_vendor = any (e.mentioned_vendor_ids)) end)
   order by e.id
   limit least(coalesce(p_limit, 300), 1000);
$$;
revoke execute on function public.vendor_name_check_emails(uuid, uuid, text, boolean, uuid, integer) from public, anon, authenticated;
grant execute on function public.vendor_name_check_emails(uuid, uuid, text, boolean, uuid, integer) to service_role;

/** Emails that now name the vendor (p_add) or no longer do (p_remove); their tags and "Who is this?" cards follow. */
create or replace function public.vendor_name_check_apply(p_check uuid, p_add uuid[], p_remove uuid[])
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c        public.vendor_name_checks%rowtype;
  v_before integer;
  v_after  integer;
  v_named  integer := 0;
  v_unnamed integer := 0;
  v_untag  integer := 0;
  v_cards  integer := 0;
  r        record;
begin
  select * into c from public.vendor_name_checks where id = p_check;
  if not found then return null; end if;
  select count(*) into v_before from public.email_vendor_tags where vendor_id = c.vendor_id and email_id = any (coalesce(p_add, '{}'));
  update public.emails set mentioned_vendor_ids = mentioned_vendor_ids || c.vendor_id
   where id = any (coalesce(p_add, '{}')) and organization_id = c.organization_id and not (c.vendor_id = any (mentioned_vendor_ids));
  get diagnostics v_named = row_count;
  select count(*) into v_after from public.email_vendor_tags where vendor_id = c.vendor_id and email_id = any (coalesce(p_add, '{}'));
  update public.emails set mentioned_vendor_ids = array_remove(mentioned_vendor_ids, c.vendor_id)
   where id = any (coalesce(p_remove, '{}')) and organization_id = c.organization_id;
  get diagnostics v_unnamed = row_count;
  delete from public.email_vendor_tags where vendor_id = c.vendor_id and how = 'auto' and email_id = any (coalesce(p_remove, '{}'));
  get diagnostics v_untag = row_count;
  for r in select distinct s.id from public.emails e join public.email_senders s on s.id = e.sender_id
            where e.id = any (coalesce(p_add, '{}') || coalesce(p_remove, '{}')) and s.kind = 'unknown' loop
    perform public.mail_refresh_sender(r.id);
    if exists (select 1 from public.email_senders s join public.review_items i on i.id = s.review_item_id and i.status = 'pending' where s.id = r.id) then
      v_cards := v_cards + 1;
    end if;
  end loop;
  update public.vendor_name_checks set emails_named = emails_named + v_named, emails_unnamed = emails_unnamed + v_unnamed,
         emails_tagged = emails_tagged + (v_after - v_before) - v_untag, cards_updated = cards_updated + v_cards, working_at = now()
   where id = p_check;
  return jsonb_build_object('named', v_named, 'unnamed', v_unnamed, 'cards', v_cards);
end;
$$;
revoke execute on function public.vendor_name_check_apply(uuid, uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.vendor_name_check_apply(uuid, uuid[], uuid[]) to service_role;

/** Words of a name the way mail matching reads them: "Thin Air Brands, LLC" → "thin air brands llc". */
create or replace function public.name_words(p text) returns text
language sql immutable as $$
  select trim(regexp_replace(replace(replace(replace(lower(coalesce(p, '')), '&', ' and '), '''', ''), '’', ''), '[^a-z0-9]+', ' ', 'g'));
$$;
grant execute on function public.name_words(text) to authenticated, service_role;

/**
 * The end of a re-check: "Who is this?" senders whose web address is the new name (gmail-sync finds them), rep line
 * cards for a brand "not one of our vendors" that is this vendor under the new name, then the counts.
 */
create or replace function public.vendor_name_check_finish(p_check uuid, p_phrases text[], p_domain_senders uuid[], p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  c       public.vendor_name_checks%rowtype;
  v       public.vendors%rowtype;
  g       public.rep_groups%rowtype;
  r       record;
  v_cards integer := 0;
begin
  select * into c from public.vendor_name_checks where id = p_check;
  if not found then return; end if;
  select * into v from public.vendors where id = c.vendor_id;
  for r in select id from public.email_senders
            where id = any (coalesce(p_domain_senders, '{}')) and organization_id = c.organization_id and kind = 'unknown'
              and not (c.vendor_id = any (domain_vendor_ids)) loop
    update public.email_senders set domain_vendor_ids = domain_vendor_ids || c.vendor_id where id = r.id;
    perform public.mail_refresh_sender(r.id);
    v_cards := v_cards + 1;
  end loop;
  if v.id is not null then
    select * into g from public.rep_groups where id = v.rep_group_id;
    for r in select i.id, i.details from public.review_items i
              where i.organization_id = c.organization_id and i.kind = 'rep_line' and i.status = 'pending'
                and i.details->>'vendor_id' is null and public.name_words(i.details->>'line_name') = any (coalesce(p_phrases, '{}')) loop
      update public.review_items set entity_type = 'vendor', entity_id = v.id,
             title = case when v.rep_group_id is null or v.rep_group_id = (r.details->>'rep_group_id')::uuid
                          then format('%s reps %s, which is our vendor %s. Add it to %s?', r.details->>'rep_group_name', r.details->>'line_name', v.name, r.details->>'rep_group_name')
                          else format('%s writes about %s, which is with %s. Move it to %s?', r.details->>'rep_group_name', v.name, g.name, r.details->>'rep_group_name') end,
             details = r.details || jsonb_build_object('vendor_id', v.id, 'vendor_name', v.name, 'current_rep_group_id', v.rep_group_id,
                                                        'current_rep_group_name', g.name, 'matched_name', r.details->>'line_name')
       where id = r.id;
      v_cards := v_cards + 1;
    end loop;
  end if;
  update public.vendor_name_checks set status = 'done', done_at = now(), working_at = null, cards_updated = cards_updated + v_cards, note = left(p_note, 300)
   where id = p_check;
end;
$$;
revoke execute on function public.vendor_name_check_finish(uuid, text[], uuid[], text) from public, anon, authenticated;
grant execute on function public.vendor_name_check_finish(uuid, text[], uuid[], text) to service_role;

create or replace function public.vendor_name_check_fail(p_check uuid, p_note text)
returns void language sql security definer set search_path = public as $$
  update public.vendor_name_checks set status = 'failed', working_at = null, done_at = now(), note = left(p_note, 300) where id = p_check;
$$;
revoke execute on function public.vendor_name_check_fail(uuid, text) from public, anon, authenticated;
grant execute on function public.vendor_name_check_fail(uuid, text) to service_role;
