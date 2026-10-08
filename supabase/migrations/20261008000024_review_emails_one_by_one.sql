-- 0045 — "Who is this mail from?", email by email (Dana, Oct 8): open the sender's emails, tick some, and
-- file them to a vendor, mark them Marketing or Other; the rest can go another way. Ticking all of them
-- is the whole-sender answer (the card buttons, future mail included). The card closes when every email
-- is handled; the sender stays undecided, so new mail from them asks again.
alter table public.emails add column if not exists disposition text check (disposition in ('marketing', 'other'));
comment on column public.emails.disposition is 'Handled one by one in the review queue: marketing (Offers & catalogs) or other (Needs attention, for Dana).';

create or replace function public.review_sender_emails(p_sender uuid, p_email_ids uuid[], p_action text, p_vendor uuid default null)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  s       public.email_senders%rowtype;
  e       record;
  v_admin uuid;
  n       integer := 0;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers file mail' using errcode = '42501'; end if;
  select * into s from public.email_senders where id = p_sender for update;
  if s.id is null or not public.user_in_org(s.organization_id) then raise exception 'Sender not found' using errcode = '23503'; end if;
  if p_action not in ('vendor', 'marketing', 'other') then raise exception 'Unknown action %', p_action using errcode = '22023'; end if;
  if p_action = 'vendor' and not exists (select 1 from public.vendors where id = p_vendor and organization_id = s.organization_id) then
    raise exception 'Pick a vendor' using errcode = '22023';
  end if;
  select id into v_admin from public.profiles where organization_id = s.organization_id and role = 'admin' and is_active order by created_at limit 1;

  for e in select * from public.emails where sender_id = p_sender and id = any (p_email_ids) loop
    if p_action = 'vendor' then
      update public.emails set vendor_id = p_vendor, match_how = 'manual', disposition = null
       where thread_id = e.thread_id and (vendor_id is null or id = e.id);
      update public.email_threads set vendor_id = p_vendor where id = e.thread_id and vendor_id is null;
      perform public.mail_auto_tag(e.id);
    else
      update public.emails set disposition = p_action, view = case when p_action = 'marketing' then 'offers' else 'attention' end, view_how = 'manual'
       where id = e.id;
      if p_action = 'other' then
        update public.email_threads set owner_id = v_admin, owner_set_at = now() where id = e.thread_id and owner_id is null and v_admin is not null;
      end if;
    end if;
    perform public.mail_refresh_thread(e.thread_id, false);
    n := n + 1;
  end loop;
  -- Conversation views follow their emails.
  perform public.mail_classify(s.organization_id, p_email_ids);

  -- Every email handled: the card is done; new mail from them asks again.
  if not exists (select 1 from public.emails where sender_id = p_sender and vendor_id is null and disposition is null) then
    update public.review_items set status = 'accepted', resolved_by = auth.uid(), resolved_at = now(), resolution_note = 'Handled email by email'
     where id = s.review_item_id and status = 'pending';
  end if;
  return n;
end;
$$;
revoke execute on function public.review_sender_emails(uuid, uuid[], text, uuid) from public, anon;
grant execute on function public.review_sender_emails(uuid, uuid[], text, uuid) to authenticated, service_role;

-- A sender whose emails are all handled gets no new card until new mail from them arrives.
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
