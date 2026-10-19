-- Questions we asked that the vendor never answered (Dana, Oct 19: "What if we wrote back and asked a question and the
-- vendor never answered" … "yes on the 220 old threads"). Old mail read in from history where we wrote last (last 6
-- months, more than a week ago) and nobody we wrote to has written back since: Claude reads our email. When it asked
-- them something or expected a reply, the conversation shows under No answer yet (waiting on the vendor, past its
-- follow-up date); a "thanks" or "got it" stays handled. No tasks or cards. billing@ and the old Gmail are left out
-- (billing@ history comes later, Dana: last priority, after launch).
alter table public.emails add column if not exists expects_reply text check (expects_reply in ('yes', 'no'));
alter table public.emails add column if not exists expects_reply_read_at timestamptz;
comment on column public.emails.expects_reply is 'Our sent email asks the other person for something / expects a reply (Claude read it; history only).';

create or replace function public.mail_unanswered_out_queue(p_org uuid, p_limit integer default 20)
returns table (email_id uuid, thread_id uuid, subject text, to_emails text[], body_text text)
language sql stable security definer set search_path = public as $$
  select e.id, t.id, e.subject, e.to_emails, left(coalesce(e.body_text, e.snippet, ''), 3000)
    from public.email_threads t
    join lateral (select * from public.emails x where x.thread_id = t.id and x.direction <> 'internal' order by x.received_at desc limit 1) e on true
   where t.organization_id = p_org and t.status = 'handled' and t.deleted_at is null
     and e.direction = 'out' and e.expects_reply_read_at is null
     and e.received_at > now() - interval '6 months' and e.received_at < now() - interval '7 days'
     -- read in from history (stored more than a week after it was sent), never a thread someone closed themselves
     and e.created_at > e.received_at + interval '7 days'
     and not exists (select 1 from public.mailboxes m where m.id = t.mailbox_id and m.kind in ('accounting', 'legacy'))
     and not exists (select 1 from public.emails i where i.organization_id = t.organization_id and i.direction = 'in' and i.received_at > e.received_at
                      and (i.thread_id = t.id or lower(i.from_email) = any (select lower(x) from unnest(e.to_emails || e.cc_emails) x)))
   order by e.received_at desc
   limit p_limit
$$;
revoke execute on function public.mail_unanswered_out_queue(uuid, integer) from public, anon, authenticated;
grant execute on function public.mail_unanswered_out_queue(uuid, integer) to service_role;

create or replace function public.mail_apply_expects_reply(p_email uuid, p_expects boolean) returns text
language plpgsql security definer set search_path = public as $$
declare e public.emails%rowtype; v_latest uuid;
begin
  select * into e from public.emails where id = p_email;
  if e.id is null then return 'missing'; end if;
  update public.emails set expects_reply = case when p_expects then 'yes' else 'no' end, expects_reply_read_at = now() where id = p_email;
  if not p_expects then return 'handled'; end if;
  select x.id into v_latest from public.emails x where x.thread_id = e.thread_id and x.direction <> 'internal' order by x.received_at desc limit 1;
  if v_latest is distinct from p_email then return 'skipped'; end if;
  -- No answer yet: waiting on them, already past the follow-up date (no task, no reminder)
  update public.email_threads set status = 'waiting_on_vendor', follow_up_at = e.received_at + interval '5 days', status_msg_at = e.received_at
   where id = e.thread_id and status = 'handled';
  return 'no_answer';
end;
$$;
revoke execute on function public.mail_apply_expects_reply(uuid, boolean) from public, anon, authenticated;
grant execute on function public.mail_apply_expects_reply(uuid, boolean) to service_role;
