-- 0024 — Mail senders, after the first real sync (Oct 8):
-- * NetSuite, Bill.com, FashionGo and similar services send mail for many vendors. A sender can now be
--   answered "sends for many vendors": each email is then matched by the one vendor it names, like rep mail.
-- * A single passing mention no longer makes a proposal ("named in 1 of 19").
-- * Our own people's addresses (profiles) are never senders to decide on.

alter table public.email_senders drop constraint if exists email_senders_kind_check;
alter table public.email_senders add constraint email_senders_kind_check check (kind in ('unknown', 'vendor', 'rep_group', 'platform', 'not_vendor', 'internal'));
alter table public.emails drop constraint if exists emails_match_how_check;
alter table public.emails add constraint emails_match_how_check check (match_how in ('thread', 'sender', 'domain', 'directory', 'rep_group', 'platform', 'manual'));

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
    elsif s.kind = 'platform' then
      -- NetSuite, Bill.com, FashionGo…: mail for many vendors; the email itself has to name exactly one.
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
  if v_best is not null then
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

create or replace function public.resolve_email_sender(p_sender uuid, p_kind text, p_vendor uuid default null, p_rep_group uuid default null)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  s        public.email_senders%rowtype;
  r        record;
  v_linked integer := 0;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers decide senders'; end if;
  select * into s from public.email_senders where id = p_sender for update;
  if not found or not public.user_in_org(s.organization_id) then raise exception 'Sender not found'; end if;
  if p_kind not in ('vendor', 'rep_group', 'platform', 'not_vendor', 'internal') then raise exception 'Unknown answer %', p_kind; end if;
  if p_kind = 'vendor' and not exists (select 1 from public.vendors where id = p_vendor and organization_id = s.organization_id) then raise exception 'Pick a vendor'; end if;
  if p_kind = 'rep_group' and not exists (select 1 from public.rep_groups where id = p_rep_group and organization_id = s.organization_id) then raise exception 'Pick a rep group'; end if;

  update public.email_senders set kind = p_kind,
    vendor_id = case when p_kind = 'vendor' then p_vendor end,
    rep_group_id = case when p_kind = 'rep_group' then p_rep_group end,
    decided_by = auth.uid(), decided_at = now()
  where id = p_sender;
  update public.review_items set status = case when p_kind in ('vendor', 'rep_group', 'platform') then 'accepted'::public.review_status else 'rejected'::public.review_status end,
         resolved_by = auth.uid(), resolved_at = now(),
         resolution_note = case p_kind when 'vendor' then 'Vendor: ' || (select name from public.vendors where id = p_vendor)
                                       when 'rep_group' then 'Rep group: ' || (select name from public.rep_groups where id = p_rep_group)
                                       when 'platform' then 'Sends for many vendors'
                                       when 'not_vendor' then 'Not a vendor' else 'Ours' end
   where id = s.review_item_id and status = 'pending';

  if p_kind in ('vendor', 'rep_group', 'platform') then
    for r in select id, thread_id from public.emails where sender_id = p_sender and vendor_id is null loop
      if public.mail_link_email(r.id) then v_linked := v_linked + 1; end if;
      perform public.mail_refresh_thread(r.thread_id, false);
    end loop;
  end if;
  return v_linked;
end;
$$;

-- Senders that are really us: close their proposals.
update public.review_items ri set status = 'rejected', resolved_at = now(), resolution_note = 'Ours'
  from public.email_senders s
 where ri.id = s.review_item_id and ri.status = 'pending'
   and s.sender_key in (select lower(p.email) from public.profiles p where p.organization_id = s.organization_id);
update public.email_senders s set kind = 'internal'
 where s.kind = 'unknown' and s.sender_key in (select lower(p.email) from public.profiles p where p.organization_id = s.organization_id);

-- Re-score open proposals with the new threshold.
do $$ declare r record; begin
  for r in select id from public.email_senders where kind = 'unknown' loop perform public.mail_refresh_sender(r.id); end loop;
end $$;
