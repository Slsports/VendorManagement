-- 0278 — Vendor mail in billing@ goes through the regular vendor channels (Dana, Nov 2): "Any emails to the billing email
-- from known vendors (ie. Becker, Manufacturers Exchange, etc.) need to go through the regular channels for vendors in
-- vms, they should not stay in accounting." … "go, share them and keep them in accounting too".
--   • billing@ shares a conversation to Orders by itself once a known vendor or rep group writes in it, like Trevor's and
--     Jarrett's mailboxes. It stays in Accounting too (sharing is not moving).
--   • Only vendor and rep group conversations: freight companies, the accountant, insurance, taxes and banks stay private.
--     A conversation where anyone else also wrote (not a vendor, rep group, order platform or our own staff) is not shared
--     by itself; Dana can share it with Share to Orders.
--   • Shared billing@ vendor mail is read for payments like other shared vendor mail (0240 left all billing@ mail out).
--   • Unshare sticks (auto_share_off), as before.
--   • Back-check: the last 12 months of billing@ vendor conversations are shared now, and their payment emails queued.
set local lock_timeout = '5s';

-- A billing@ conversation that may go to Orders: a known vendor or rep group wrote in it.
create or replace function public.accounting_thread_is_vendor(p_thread uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.emails e join public.email_senders s on s.id = e.sender_id
                  where e.thread_id = p_thread and e.direction = 'in' and s.kind in ('vendor', 'rep_group'))
$$;
revoke execute on function public.accounting_thread_is_vendor(uuid) from public, anon, authenticated;
grant execute on function public.accounting_thread_is_vendor(uuid) to service_role;

-- … and only vendor mail: nobody else (the accountant, a bank, an unknown sender) wrote in it.
create or replace function public.accounting_thread_only_vendor(p_thread uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.accounting_thread_is_vendor(p_thread)
     and not exists (select 1 from public.emails e left join public.email_senders s on s.id = e.sender_id
                      where e.thread_id = p_thread and e.direction = 'in'
                        and coalesce(s.kind::text, '') not in ('vendor', 'rep_group', 'platform', 'internal'))
$$;
revoke execute on function public.accounting_thread_only_vendor(uuid) from public, anon, authenticated;
grant execute on function public.accounting_thread_only_vendor(uuid) to service_role;

-- billing@ conversations can be shared to Orders when a vendor or rep group wrote in them; everything else stays private.
create or replace function public.email_threads_accounting_private() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.shared_at is not null and new.mailbox_id is not null
     and exists (select 1 from public.mailboxes m where m.id = new.mailbox_id and m.kind = 'accounting')
     and not public.accounting_thread_is_vendor(new.id) then
    raise exception 'Accounting mail stays private; only conversations with a vendor or rep group can be shared to Orders' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Auto-share: as before for staff mailboxes and the Old Gmail (vendors, rep groups, freight companies); in billing@ only
-- vendors and rep groups, and only conversations nobody else wrote in.
create or replace function public.share_vendor_threads(p_org uuid, p_email uuid default null, p_sender uuid default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with hit as (
    select distinct e.thread_id, m.kind as box_kind
      from public.emails e
      join public.email_senders s on s.id = e.sender_id and s.kind in ('vendor', 'rep_group', 'carrier')
      join public.mailboxes m on m.id = e.mailbox_id and m.auto_share_vendor_mail
     where e.organization_id = p_org and e.direction = 'in' and e.mailbox_id is not null and e.thread_id is not null
       and (p_email is null or e.id = p_email)
       and (p_sender is null or e.sender_id = p_sender)
       and (p_email is not null or e.received_at > now() - interval '365 days')
       and (m.kind <> 'accounting' or s.kind in ('vendor', 'rep_group'))
  )
  update public.email_threads t set shared_at = now()
    from hit
   where t.id = hit.thread_id and t.mailbox_id is not null and t.shared_at is null and not t.auto_share_off
     and (hit.box_kind <> 'accounting' or public.accounting_thread_only_vendor(t.id));
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.share_vendor_threads(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.share_vendor_threads(uuid, uuid, uuid) to service_role;

-- Payment emails: shared billing@ vendor mail is read too (private mail still is not).
create or replace function public.payment_notice_candidates(p_org uuid, p_since timestamptz)
returns table (email_id uuid, vendor_id uuid)
language sql stable security definer set search_path = public as $$
  select e.id, e.vendor_id
    from public.emails e
    left join public.email_threads t on t.id = e.thread_id
   where e.organization_id = p_org and e.vendor_id is not null and e.copy_of is null and e.received_at > p_since
     and (e.mailbox_id is null or t.shared_at is not null)
     and (e.subject ~* '(\mpaid\M|payment|remittance|bill ?pay)'
          or e.body_text ~* '(have been paid|has been paid|been paid through|we paid|i paid|payment (has been |was )?(sent|initiated|made|submitted|processed|received)|paid (in full|through|via|on the|online)|remittance)')
     and not exists (select 1 from public.payment_notices n where n.email_id = e.id)
$$;
revoke execute on function public.payment_notice_candidates(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.payment_notice_candidates(uuid, timestamptz) to service_role;

comment on column public.mailboxes.auto_share_vendor_mail is 'Conversations with a known vendor or rep group are shared to Orders automatically (Dana, Oct 13: not her own mailbox; Nov 2: billing@ too, vendors and rep groups only).';
update public.mailboxes set auto_share_vendor_mail = true where kind = 'accounting' and not auto_share_vendor_mail;

-- Back-check: share the last 12 months of billing@ vendor conversations, then queue their payment emails.
select o.id, public.share_vendor_threads(o.id) from public.organizations o;
insert into public.payment_notices (email_id, organization_id, vendor_id)
select c.email_id, o.id, c.vendor_id from public.organizations o, public.payment_notice_candidates(o.id, now() - interval '12 months') c
on conflict (email_id) do nothing;
