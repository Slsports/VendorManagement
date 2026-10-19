-- History without to-dos, and "handled" read from the conversation (Dana, Oct 19: "I want as much historical data as
-- possible added to vms without adding to do's … So if something came in 2 months ago and it needed attention, but you
-- can see no one has responded, I want to know about it"; "6 months is good, go").
-- 1. Old mail read in (backfill) is handled only when one of us answered it, we wrote last, it is bulk mail, or it is
--    over 6 months old. An unanswered question from the last 6 months waits on us (Needs an answer); Claude's reply
--    check then reads it like new mail, and an unsure one stays in Needs an answer (no review card for history).
-- 2. Senders last heard from over a year ago get no "which vendor?" card.
-- 3. Back-check: threads the old 7-day rule marked handled are read again with this rule (billing@ keeps its own
--    30-day reply check and is left alone).
-- 4. orders@ is read back to the beginning (it started at Oct 2025), like Jarrett's mailbox.

-- Did one of us write to this email's sender after it (any of our mailboxes, in its thread or a new email)?
create or replace function public.mail_answered(p_email uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.emails e
    join public.emails o on o.organization_id = e.organization_id and o.direction = 'out' and o.received_at > e.received_at
     and (o.thread_id = e.thread_id or lower(e.from_email) = any (select lower(x) from unnest(o.to_emails || o.cc_emails) x))
    where e.id = p_email)
$$;
revoke execute on function public.mail_answered(uuid) from public, anon, authenticated;
grant execute on function public.mail_answered(uuid) to service_role;

create or replace function public.mail_refresh_thread(p_thread uuid, p_backfill boolean default false)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  t        public.email_threads%rowtype;
  last_e   public.emails%rowtype;
  v_vendor uuid;
  v_days   integer;
  v_owner  uuid;
  v_promise boolean;
  v_old    boolean;
  v_old_open boolean;
begin
  select * into t from public.email_threads where id = p_thread for update;
  if not found then return; end if;
  if t.vendor_id is null then
    select vendor_id into v_vendor from public.emails where thread_id = p_thread and vendor_id is not null
     group by vendor_id order by count(*) desc, max(received_at) desc limit 1;
  end if;
  update public.email_threads th set
    vendor_id       = coalesce(th.vendor_id, v_vendor),
    message_count   = (select count(*) from public.emails where thread_id = p_thread),
    subject         = coalesce(th.subject, (select subject from public.emails where thread_id = p_thread order by received_at limit 1)),
    last_in_at      = (select max(received_at) from public.emails where thread_id = p_thread and direction = 'in'),
    last_out_at     = (select max(received_at) from public.emails where thread_id = p_thread and direction = 'out'),
    last_message_at = (select max(received_at) from public.emails where thread_id = p_thread)
  where th.id = p_thread
  returning * into t;

  select * into last_e from public.emails where thread_id = p_thread and direction <> 'internal' order by received_at desc limit 1;
  if last_e.id is not null and last_e.received_at > coalesce(t.status_msg_at, '-infinity'::timestamptz) then
    -- a newer reply of ours ends the promises made in earlier ones
    if last_e.direction = 'out' then
      update public.tasks set done_at = now(), done_note = 'Replied again'
       where thread_id = p_thread and done_at is null and auto_key like 'promise:%' and auto_key <> 'promise:' || last_e.id;
    end if;
    v_promise := last_e.direction = 'out' and exists (select 1 from public.tasks where auto_key = 'promise:' || last_e.id and done_at is null);
    select follow_up_days into v_days from public.mail_accounts where organization_id = t.organization_id;
    -- Old mail read in (backfill): handled when we wrote last, when it is over 6 months old, when it is bulk mail or
    -- billing@ history, or when one of us wrote back to that person after it (any of our mailboxes, any thread).
    -- Anything else asked us something nobody answered: it waits on us, and the reply check reads it (Dana, Oct 19).
    v_old := p_backfill and last_e.received_at < now() - interval '7 days';
    v_old_open := v_old and last_e.direction = 'in' and last_e.received_at > now() - interval '6 months'
      and not coalesce(last_e.is_bulk, false)
      and not exists (select 1 from public.mailboxes m where m.id = t.mailbox_id and m.kind in ('accounting', 'legacy'))
      and not public.mail_answered(last_e.id);
    update public.email_threads set
      status = case when v_old and not v_old_open then 'handled'
                    when last_e.direction = 'in' or v_promise then 'waiting_on_us' else 'waiting_on_vendor' end,
      follow_up_at = case when last_e.direction = 'out' and not v_promise and not v_old
                          then last_e.received_at + make_interval(days => coalesce(v_days, 5)) end,
      status_msg_at = last_e.received_at
    where id = p_thread;
  end if;

  -- Fill the owner once there is one to give; every later message follows it.
  if t.owner_id is null then
    v_owner := public.mail_default_owner(p_thread);
    if v_owner is not null then update public.email_threads set owner_id = v_owner, owner_set_at = now() where id = p_thread; end if;
  end if;

  -- Messages in a vendor's thread belong to that vendor.
  update public.emails e set vendor_id = t.vendor_id, match_how = 'thread'
   where e.thread_id = p_thread and e.vendor_id is null and t.vendor_id is not null;
end;
$$;

create or replace function public.mail_apply_reply(p_email uuid, p_reply text, p_note text, p_ship text, p_shipper uuid)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  e        public.emails%rowtype;
  t        public.email_threads%rowtype;
  s        public.email_senders%rowtype;
  v_reply  text := p_reply;
  v_item   uuid;
  v_latest uuid;
begin
  select * into e from public.emails where id = p_email;
  if e.id is null then return 'missing'; end if;
  update public.emails set reply_needed = p_reply, reply_note = left(p_note, 300), reply_read_at = now(), ship_status = coalesce(p_ship, ship_status) where id = p_email;
  select * into t from public.email_threads where id = e.thread_id for update;
  select * into s from public.email_senders where id = e.sender_id;

  if p_ship is not null then
    update public.email_threads set ship_status = p_ship, ship_status_at = e.received_at
     where id = t.id and (ship_status_at is null or ship_status_at <= e.received_at);
  end if;

  -- A carrier's update belongs to the shipper, not to a name inside it ("Oak Harbor Freight").
  if p_shipper is not null and s.kind = 'carrier' and exists (select 1 from public.vendors where id = p_shipper and organization_id = e.organization_id) then
    update public.emails set vendor_id = p_shipper, match_how = 'shipper'
     where thread_id = t.id and (vendor_id is null or match_how in ('platform', 'thread', 'shipper'));
    update public.email_threads set vendor_id = p_shipper where id = t.id;
    insert into public.email_vendor_tags (email_id, vendor_id, organization_id, how)
    values (p_email, p_shipper, e.organization_id, 'ai') on conflict do nothing;
  end if;

  -- Only the newest incoming email decides, and only while the conversation is waiting on us.
  select x.id into v_latest from public.emails x where x.thread_id = t.id and x.direction <> 'internal' order by x.received_at desc limit 1;
  if v_latest is distinct from p_email or t.status <> 'waiting_on_us' then return 'skipped'; end if;

  if v_reply = 'unsure' and s.auto_no_reply then v_reply := 'no'; end if;
  -- an old email read in from history: no "Does this need an answer?" card (no to-dos from history, Dana Oct 19);
  -- it stays in Needs an answer for a person to look at
  if v_reply = 'unsure' and e.received_at < now() - interval '7 days' then return 'needs'; end if;
  if v_reply = 'no' then
    update public.email_threads set status = 'handled' where id = t.id;
    return 'handled';
  elsif v_reply = 'unsure' then
    select id into v_item from public.review_items where kind = 'mail_reply' and entity_id = t.id and status = 'pending' limit 1;
    if v_item is not null then
      update public.review_items set details = details || jsonb_build_object('email_id', p_email, 'from', coalesce(e.from_name, e.from_email), 'snippet', e.snippet, 'note', p_note, 'received_at', e.received_at)
       where id = v_item;
    else
      insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details, assigned_to, assigned_at)
      values (e.organization_id, 'mail_reply', 'email_thread', t.id, 'Does this need an answer? ' || coalesce(nullif(t.subject, ''), '(no subject)'),
              jsonb_build_object('email_id', p_email, 'thread_id', t.id, 'sender_id', e.sender_id, 'from', coalesce(e.from_name, e.from_email),
                                 'from_email', e.from_email, 'subject', t.subject, 'snippet', e.snippet, 'note', p_note, 'received_at', e.received_at),
              t.owner_id, case when t.owner_id is not null then now() end);
    end if;
    return 'review';
  end if;
  return 'needs';
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
  -- Every email from them is filed or handled one by one: nothing to ask until new mail comes.
  if not exists (select 1 from public.emails where sender_id = p_sender and vendor_id is null and disposition is null) then return; end if;
  -- Someone we have not heard from in a year (mail read in from history): no "which vendor?" card (Dana, Oct 19:
  -- history comes in without adding to-dos). New mail from them brings the question back.
  if (select max(received_at) from public.emails where sender_id = p_sender) < now() - interval '12 months' then return; end if;

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

-- The back-check: handled threads whose newest email is an unread question from the last 6 months that nobody
-- answered go back to Needs an answer. Claude never read them (no reply check yet), so a person or Claude never
-- closed them; the old 7-day rule did.
create or replace function public.mail_reopen_unanswered(p_org uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_checked integer; v_open integer;
begin
  with cand as (
    select t.id, e.id eid
      from public.email_threads t
      join lateral (select * from public.emails x where x.thread_id = t.id and x.direction <> 'internal' order by x.received_at desc limit 1) e on true
     where t.organization_id = p_org and t.status = 'handled' and t.deleted_at is null
       and e.direction = 'in' and e.reply_read_at is null and e.received_at > now() - interval '6 months'
       and not coalesce(e.is_bulk, false)
       and not exists (select 1 from public.mailboxes m where m.id = t.mailbox_id and m.kind in ('accounting', 'legacy'))),
  open as (
    update public.email_threads t set status = 'waiting_on_us', status_msg_at = null
      from cand where t.id = cand.id and not public.mail_answered(cand.eid)
    returning t.id)
  select (select count(*) from cand), (select count(*) from open) into v_checked, v_open;
  return jsonb_build_object('checked', v_checked, 'reopened', v_open);
end;
$$;
revoke execute on function public.mail_reopen_unanswered(uuid) from public, anon, authenticated;
grant execute on function public.mail_reopen_unanswered(uuid) to service_role;

-- orders@ from the beginning (old threads come in by the rules above).
update public.mail_accounts set backfill_after = '2015-01-01', backfill_page_token = null, backfill_done = false
 where backfill_after > '2015-01-01';
