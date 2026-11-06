-- 0320 — A billing@ conversation put on a contact by hand stays there (Dana, Nov 6: "yes, make hand-placed ones stay").
-- Until now the "Who" pick list on a billing@ conversation set its contact, and the next re-match (a new email in it,
-- confirming or ignoring a contact, saving a contact, a back-check) could put it back on whatever its address matched.
--   • Picking a contact, or taking it off (— pick a contact —), marks the conversation placed by hand; no automatic
--     matching changes it again, new mail in it included. Merging contacts still moves it to the merged contact.
--   • "Let VMS match it" on the same list takes the mark off and matches it by its address again.
-- Earlier hand placements were not recorded, so none can be marked now; from today every hand placement is.
set local lock_timeout = '5s';

alter table public.email_threads add column if not exists accounting_contact_by_hand boolean not null default false;
comment on column public.email_threads.accounting_contact_by_hand is 'Accounting: the contact was picked by hand on the conversation; automatic matching leaves it alone';

-- Matching one conversation: leaves a hand-placed one as it is.
create or replace function public.accounting_match_thread(p_thread uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_contact uuid; v_hand boolean;
begin
  select organization_id, accounting_contact_by_hand, accounting_contact_id into v_org, v_hand, v_contact from public.email_threads where id = p_thread;
  if v_hand then return v_contact; end if;
  v_contact := public.accounting_contact_for(v_org, public.accounting_thread_counterpart(p_thread));
  update public.email_threads set accounting_contact_id = v_contact where id = p_thread and not accounting_contact_by_hand and accounting_contact_id is distinct from v_contact;
  return v_contact;
end;
$$;

-- The full re-match for back-checks: same as 0319, hand-placed conversations left alone.
create or replace function public.accounting_rematch_all(p_org uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if auth.uid() is not null and not (public.sees_accounting() and public.user_in_org(p_org)) then raise exception 'Accounting only' using errcode = '42501'; end if;
  with own as (
    select coalesce((select array_agg(distinct lower(d)) from public.mail_accounts a, unnest(a.internal_domains) d where a.organization_id = p_org), '{}') as domains,
           coalesce((select array_agg(lower(x)) from public.organizations o, unnest(o.own_addresses) x where o.id = p_org), '{}') as addrs
  ), th as (
    select t.id, t.accounting_contact_id from public.email_threads t join public.mailboxes m on m.id = t.mailbox_id and m.kind = 'accounting'
     where t.organization_id = p_org and not t.accounting_contact_by_hand
  ), cp as (
    select distinct on (e.thread_id) e.thread_id, x.addr
      from th join public.emails e on e.thread_id = th.id
      cross join lateral unnest(case when e.direction = 'in' then array[e.from_email] else e.to_emails end) x0(a)
      cross join lateral (select lower(x0.a) as addr) x, own
     where e.copy_of is null and x.addr is not null
       and not (split_part(x.addr, '@', 2) = any (own.domains) or x.addr = any (own.addrs))
     order by e.thread_id, e.received_at desc, x.addr
  ), ct as (
    select d.addr, public.accounting_contact_for(p_org, d.addr) as contact_id from (select distinct addr from cp) d
  ), want as (
    select th.id, ct.contact_id from th left join cp on cp.thread_id = th.id left join ct on ct.addr = cp.addr
  )
  update public.email_threads t set accounting_contact_id = w.contact_id
    from want w where t.id = w.id and not t.accounting_contact_by_hand and t.accounting_contact_id is distinct from w.contact_id;
  select count(*) into n from public.email_threads t join public.mailboxes m on m.id = t.mailbox_id and m.kind = 'accounting'
   where t.organization_id = p_org and t.accounting_contact_id is not null;
  return n;
end;
$$;

-- Put a conversation on a contact by hand (or take it off with null); p_auto = "Let VMS match it" again.
drop function if exists public.accounting_set_thread_contact(uuid, uuid);
create or replace function public.accounting_set_thread_contact(p_thread uuid, p_contact uuid, p_auto boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.sees_accounting() then raise exception 'Accounting only' using errcode = '42501'; end if;
  if not exists (select 1 from public.email_threads t join public.mailboxes m on m.id = t.mailbox_id and m.kind = 'accounting'
                  where t.id = p_thread and public.user_in_org(t.organization_id)) then
    raise exception 'Conversation not found' using errcode = '23503';
  end if;
  if p_contact is not null and not exists (select 1 from public.accounting_contacts c join public.email_threads t on t.organization_id = c.organization_id
                                            where c.id = p_contact and t.id = p_thread) then
    raise exception 'Contact not found' using errcode = '23503';
  end if;
  if p_auto then
    update public.email_threads set accounting_contact_by_hand = false where id = p_thread;
    perform public.accounting_match_thread(p_thread);
  else
    update public.email_threads set accounting_contact_id = p_contact, accounting_contact_by_hand = true where id = p_thread;
  end if;
end;
$$;
revoke execute on function public.accounting_set_thread_contact(uuid, uuid, boolean) from public, anon;
grant execute on function public.accounting_set_thread_contact(uuid, uuid, boolean) to authenticated, service_role;
