-- 0051 — Does this email need an answer? (Dana, Oct 8). Every incoming email used to land in "Needs an
-- answer", tracking updates and ads included. Now Claude reads the newest email of each waiting
-- conversation: sure that no reply is needed (a tracking update "Completed", an automatic invoice notice,
-- an ad) → Handled; a real question → stays; not 100% sure → a "Does this need an answer?" card in the
-- review queue for the conversation's owner. Shipping updates show their status (Delivered…) and are filed
-- to the shipper, never to a carrier's name. Three "No answer needed" answers about one sender teach VMS:
-- that sender's unsure emails go to Handled from then on (a real question still stays).
alter table public.emails add column if not exists reply_needed text check (reply_needed in ('yes', 'no', 'unsure'));
alter table public.emails add column if not exists reply_note text;
alter table public.emails add column if not exists reply_read_at timestamptz;
alter table public.emails add column if not exists ship_status text check (ship_status in ('picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'exception'));
alter table public.email_threads add column if not exists ship_status text check (ship_status in ('picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'exception'));
alter table public.email_threads add column if not exists ship_status_at timestamptz;
alter table public.email_senders add column if not exists no_reply_answers integer not null default 0;
alter table public.email_senders add column if not exists auto_no_reply boolean not null default false;
comment on column public.email_senders.auto_no_reply is 'A person said "No answer needed" three times: unsure emails from this sender go to Handled.';
alter table public.emails drop constraint if exists emails_match_how_check;
alter table public.emails add constraint emails_match_how_check check (match_how in ('thread', 'sender', 'domain', 'directory', 'rep_group', 'platform', 'manual', 'receipt', 'shipper'));

-- The newest incoming email of each conversation waiting on us that Claude has not read yet.
create or replace function public.mail_reply_queue(p_org uuid, p_limit integer default 20)
returns table (email_id uuid, thread_id uuid, subject text, from_email text, from_name text, body_text text, sender_kind text, carrier text)
language sql stable security definer
set search_path = public
as $$
  select e.id, e.thread_id, e.subject, e.from_email, e.from_name, left(coalesce(e.body_text, e.snippet, ''), 6000), s.kind, c.name
    from public.email_threads t
    join lateral (select * from public.emails x where x.thread_id = t.id and x.direction <> 'internal' order by x.received_at desc limit 1) e on true
    left join public.email_senders s on s.id = e.sender_id
    left join public.carriers c on c.id = s.carrier_id
   where t.organization_id = p_org and t.status = 'waiting_on_us' and e.direction = 'in' and e.reply_read_at is null
   order by e.received_at desc
   limit p_limit
$$;
revoke execute on function public.mail_reply_queue(uuid, integer) from public, anon, authenticated;
grant execute on function public.mail_reply_queue(uuid, integer) to service_role;

-- What Claude read, applied (gmail-sync). p_reply: yes | no (sure) | unsure.
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
revoke execute on function public.mail_apply_reply(uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.mail_apply_reply(uuid, text, text, text, uuid) to service_role;

-- The card's buttons.
create or replace function public.answer_mail_reply(p_item uuid, p_needs_answer boolean)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  it       public.review_items%rowtype;
  v_sender uuid;
  v_email  uuid;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers handle mail' using errcode = '42501'; end if;
  select * into it from public.review_items where id = p_item for update;
  if it.id is null or it.kind <> 'mail_reply' or not public.user_in_org(it.organization_id) then raise exception 'Review item not found' using errcode = '23503'; end if;
  v_email := nullif(it.details->>'email_id', '')::uuid;
  v_sender := (select sender_id from public.emails where id = v_email);
  if p_needs_answer then
    update public.emails set reply_needed = 'yes' where id = v_email;
    update public.email_threads set status = 'waiting_on_us' where id = it.entity_id and status <> 'waiting_on_us';
  else
    update public.emails set reply_needed = 'no' where id = v_email;
    update public.email_threads set status = 'handled' where id = it.entity_id;
    update public.email_senders set no_reply_answers = no_reply_answers + 1, auto_no_reply = auto_no_reply or no_reply_answers + 1 >= 3 where id = v_sender;
  end if;
  update public.review_items set status = 'accepted', resolved_by = auth.uid(), resolved_at = now(),
         resolution_note = case when p_needs_answer then 'Needs an answer' else 'No answer needed' end
   where id = p_item;
end;
$$;
revoke execute on function public.answer_mail_reply(uuid, boolean) from public, anon;
grant execute on function public.answer_mail_reply(uuid, boolean) to authenticated, service_role;

-- Answered or handled in Mail: the card is done too.
create or replace function public.email_threads_close_reply_items()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'waiting_on_us' and new.status <> 'waiting_on_us' then
    update public.review_items set status = 'accepted', resolved_at = now(), resolution_note = 'Handled in Mail'
     where kind = 'mail_reply' and entity_id = new.id and status = 'pending';
  end if;
  return null;
end;
$$;
drop trigger if exists email_threads_close_reply_items on public.email_threads;
create trigger email_threads_close_reply_items after update of status on public.email_threads for each row execute function public.email_threads_close_reply_items();
revoke execute on function public.email_threads_close_reply_items() from public, anon, authenticated;
