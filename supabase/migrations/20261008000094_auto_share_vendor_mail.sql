-- 0115 — Vendor mail in a personal mailbox is shared to Orders by itself (Dana, Oct 13): "Is it possible to have the
-- private email rule bypass it if the order is from a known vendor?" … "I mean if the email is from a known vendor" …
-- "Can we exclude my personal email from automatically getting added?" … "I think its fine to auto share the old Gmail,
-- just not mine." A conversation in Trevor's or Jarrett's mailbox or the Old Gmail is shared to Orders once an email in it
-- comes from a known vendor or rep group (its sender is filed as one). Dana's own mailbox never is. Unshare sticks: a
-- conversation someone unshared is not shared again by this.

alter table public.mailboxes add column if not exists auto_share_vendor_mail boolean not null default true;
comment on column public.mailboxes.auto_share_vendor_mail is 'Conversations with a known vendor or rep group are shared to Orders automatically (Dana, Oct 13: not her own mailbox).';
update public.mailboxes m set auto_share_vendor_mail = false
 where m.kind = 'personal' and m.owner_id = public.org_admin(m.organization_id) and m.auto_share_vendor_mail;

alter table public.email_threads add column if not exists auto_share_off boolean not null default false;
comment on column public.email_threads.auto_share_off is 'Someone unshared it: vendor mail no longer shares it to Orders by itself.';

-- Share the conversations in auto-share mailboxes where a known vendor or rep group wrote: one email's, one sender's,
-- or (both null) everything from the last 12 months. Returns how many were shared.
create or replace function public.share_vendor_threads(p_org uuid, p_email uuid default null, p_sender uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with hit as (
    select distinct e.thread_id
      from public.emails e
      join public.email_senders s on s.id = e.sender_id and s.kind in ('vendor', 'rep_group')
      join public.mailboxes m on m.id = e.mailbox_id and m.auto_share_vendor_mail
     where e.organization_id = p_org and e.direction = 'in' and e.mailbox_id is not null and e.thread_id is not null
       and (p_email is null or e.id = p_email)
       and (p_sender is null or e.sender_id = p_sender)
       and (p_email is not null or e.received_at > now() - interval '365 days')
  )
  update public.email_threads t set shared_at = now()
    from hit
   where t.id = hit.thread_id and t.mailbox_id is not null and t.shared_at is null and not t.auto_share_off;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.share_vendor_threads(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.share_vendor_threads(uuid, uuid, uuid) to service_role;

-- New mail from a known vendor in a personal mailbox shares its conversation.
create or replace function public.emails_share_vendor_mail() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.mailbox_id is not null and new.direction = 'in' and new.sender_id is not null then
    perform public.share_vendor_threads(new.organization_id, new.id, null);
  end if;
  return new;
end;
$$;
drop trigger if exists emails_share_vendor_mail on public.emails;
create trigger emails_share_vendor_mail after insert or update of sender_id on public.emails
  for each row execute function public.emails_share_vendor_mail();

-- A sender filed as a vendor or rep group later (Who is this?): their conversations in personal mailboxes are shared too.
create or replace function public.email_senders_share_vendor_mail() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind in ('vendor', 'rep_group') and old.kind is distinct from new.kind then
    perform public.share_vendor_threads(new.organization_id, null, new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists email_senders_share_vendor_mail on public.email_senders;
create trigger email_senders_share_vendor_mail after update of kind on public.email_senders
  for each row execute function public.email_senders_share_vendor_mail();

-- Unsharing sticks; sharing by hand clears it.
create or replace function public.share_thread_to_orders(p_thread uuid, p_share boolean default true)
returns void
language plpgsql security definer set search_path = public as $$
declare t public.email_threads%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers handle mail' using errcode = '42501'; end if;
  select * into t from public.email_threads where id = p_thread for update;
  if t.id is null or t.mailbox_id is null or not public.can_see_mailbox(t.mailbox_id) then raise exception 'Conversation not found' using errcode = '23503'; end if;
  update public.email_threads set shared_at = case when p_share then now() end, shared_by = case when p_share then auth.uid() end,
         auto_share_off = not p_share
   where id = p_thread;
end;
$$;

-- The last 12 months.
select public.share_vendor_threads(o.id) from public.organizations o where exists (select 1 from public.mailboxes m where m.organization_id = o.id);
