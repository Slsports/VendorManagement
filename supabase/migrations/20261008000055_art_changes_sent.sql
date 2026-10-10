-- 0076 — Artwork approvals: "Needs changes" is on us until the changes are sent (Dana, Oct 10: "I haven't sent
-- anything over yet for the changes… I need it to pop up in there that I have something to do on it").
--   waiting        the vendor's artwork waits on our approval (on the card)
--   needs_changes  we want changes and still have to send them (on the card: "Changes to send")
--   changes_sent   we asked for the changes; waiting on the vendor's new proof (card, "waiting on the vendor")
--   approved       done
-- Our reply asking for changes, or the "Changes sent" button, moves it to changes_sent; a new proof from the
-- vendor brings it back to waiting.
alter table public.email_threads drop constraint if exists email_threads_art_status_check;
alter table public.email_threads add constraint email_threads_art_status_check check (art_status in ('waiting', 'needs_changes', 'changes_sent', 'approved'));
drop index if exists public.email_threads_art_idx;
create index if not exists email_threads_art_idx on public.email_threads (organization_id, art_since) where art_status in ('waiting', 'needs_changes', 'changes_sent');

create or replace function public.mail_art_queue(p_org uuid, p_limit integer default 20)
returns table (email_id uuid, thread_id uuid, direction text, subject text, from_name text, body_text text, attachments text[], art_status text)
language sql stable security definer set search_path = public as $$
  select e.id, e.thread_id, e.direction, e.subject, coalesce(e.from_name, e.from_email), left(coalesce(e.body_text, e.snippet, ''), 4000),
         (select coalesce(array_agg(a.file_name || ' (' || coalesce(round(a.size / 1024.0)::text, '?') || ' KB)' order by a.file_name), '{}') from public.email_attachments a where a.email_id = e.id), t.art_status
    from public.emails e
    join public.email_threads t on t.id = e.thread_id
    left join public.email_senders s on s.id = e.sender_id
   where e.organization_id = p_org and e.art_read_at is null and t.deleted_at is null
     and e.received_at > now() - interval '60 days'
     and ((e.direction = 'in' and not coalesce(e.is_bulk, false) and coalesce(s.kind, 'unknown') not in ('marketing', 'carrier', 'not_vendor', 'internal'))
          or (e.direction = 'out' and t.art_status in ('waiting', 'needs_changes', 'changes_sent')))
   order by e.received_at desc
   limit p_limit
$$;
revoke execute on function public.mail_art_queue(uuid, integer) from public, anon, authenticated;
grant execute on function public.mail_art_queue(uuid, integer) to service_role;

create or replace function public.mail_apply_art(p_email uuid, p_art text, p_note text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  e        public.emails%rowtype;
  t        public.email_threads%rowtype;
  v_who    uuid;
  v_item   uuid;
begin
  select * into e from public.emails where id = p_email;
  if e.id is null then return 'missing'; end if;
  select * into t from public.email_threads where id = e.thread_id for update;
  v_who := public.art_approver(e.organization_id);
  if e.direction = 'out' then
    update public.emails set art_read_at = now(), art_note = left(p_note, 300) where id = p_email;
    if t.art_status in ('waiting', 'needs_changes', 'changes_sent') and e.received_at >= coalesce(t.art_since, '-infinity') then
      if p_art = 'approved' then
        update public.email_threads set art_status = 'approved', art_note = left(p_note, 300) where id = t.id;
        return 'approved';
      elsif p_art = 'changes' then
        update public.email_threads set art_status = 'changes_sent', art_note = left(p_note, 300) where id = t.id;
        return 'changes_sent';
      end if;
    end if;
    return 'skipped';
  end if;

  update public.emails set art_needed = p_art, art_note = left(p_note, 300), art_read_at = now() where id = p_email;
  if p_art = 'yes' then
    -- a new proof restarts the clock only when the last one was settled
    update public.email_threads set art_status = 'waiting', art_note = left(p_note, 300), art_email_id = p_email,
           art_since = case when art_status = 'waiting' then art_since else e.received_at end,
           owner_id = coalesce(v_who, owner_id), owner_set_at = case when v_who is not null and owner_id is distinct from v_who then now() else owner_set_at end,
           status = case when status = 'handled' then 'waiting_on_us' else status end
     where id = t.id and (art_status is distinct from 'approved' or art_since is null or e.received_at > art_since);
    return 'waiting';
  elsif p_art = 'unsure' and t.art_status is null then
    select id into v_item from public.review_items where kind = 'art_approval' and entity_id = t.id and status = 'pending' limit 1;
    if v_item is null then
      insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details, assigned_to, assigned_at)
      values (e.organization_id, 'art_approval', 'email_thread', t.id, 'Artwork to approve? ' || coalesce(nullif(t.subject, ''), '(no subject)'),
              jsonb_build_object('email_id', p_email, 'thread_id', t.id, 'from', coalesce(e.from_name, e.from_email), 'subject', t.subject,
                                 'snippet', e.snippet, 'note', p_note, 'received_at', e.received_at),
              v_who, case when v_who is not null then now() end);
    end if;
    return 'review';
  end if;
  return 'no';
end;
$$;
revoke execute on function public.mail_apply_art(uuid, text, text) from public, anon, authenticated;
grant execute on function public.mail_apply_art(uuid, text, text) to service_role;

create or replace function public.set_art_status(p_thread uuid, p_status text)
returns void
language plpgsql security definer set search_path = public as $$
declare t public.email_threads%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers handle mail' using errcode = '42501'; end if;
  select * into t from public.email_threads where id = p_thread for update;
  if t.id is null or not public.user_in_org(t.organization_id) then raise exception 'Conversation not found' using errcode = '23503'; end if;
  if p_status not in ('waiting', 'needs_changes', 'changes_sent', 'approved', 'none') then raise exception 'Unknown status %', p_status; end if;
  update public.email_threads set
    art_status = nullif(p_status, 'none'),
    art_since = case when p_status = 'none' then null else coalesce(art_since, (select max(received_at) from public.emails where thread_id = t.id and direction = 'in')) end,
    owner_id = case when p_status = 'waiting' then coalesce(public.art_approver(t.organization_id), owner_id) else owner_id end
   where id = p_thread;
  update public.review_items set status = 'accepted', resolved_by = auth.uid(), resolved_at = now(),
         resolution_note = case when p_status = 'none' then 'Not artwork' else 'Artwork approval' end
   where kind = 'art_approval' and entity_id = p_thread and status = 'pending';
end;
$$;
revoke execute on function public.set_art_status(uuid, text) from public, anon;
grant execute on function public.set_art_status(uuid, text) to authenticated, service_role;
