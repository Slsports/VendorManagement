-- 0233 — Old vendors made inactive, and an alert when one comes back (Dana, Oct 23–24): "if we have not added any inventory
-- since the initial data upload to LS … they get marked as inactive, and we can reactivate them anytime. Vms should flag
-- for review if we get an order email from them or we request a catalog or pricelist, or any other verbiage indicating
-- we are looking into ordering." Plus a tick for vendors bought for the hardware store (SLH), a separate LS account VMS
-- can't see: "there are only a couple".
--
--   • vendors.inactive_reason / inactive_at: why and when VMS (or a person) made it inactive; cleared on reactivation.
--   • vendors.is_slh_vendor: bought for SLH; never made inactive by the LS rule.
--   • inactive_vendor_mail: each orders@ email that may involve an inactive vendor is read once by Claude (mail-commands):
--     ordering or looking into ordering (an order, confirmation, quote, a catalog or price list asked for or sent) makes an
--     "inactive_vendor" Review card: Make active again / Keep inactive, with the email one click away.
--   • An order made in VMS for an inactive vendor makes the same card.

set local lock_timeout = '5s';

alter table public.vendors add column if not exists inactive_reason text;
alter table public.vendors add column if not exists inactive_at timestamptz;
alter table public.vendors add column if not exists is_slh_vendor boolean not null default false;
comment on column public.vendors.inactive_reason is 'Why the vendor is inactive (shown on its page); cleared when it is made active again.';
comment on column public.vendors.is_slh_vendor is 'Bought for Shaver Lake Hardware (a separate LS account VMS cannot see): never made inactive by the LS rule.';

create or replace function public.vendors_inactive_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.is_active then
    new.inactive_reason := null; new.inactive_at := null;
  elsif tg_op = 'INSERT' or old.is_active then
    new.inactive_at := coalesce(new.inactive_at, now());
  end if;
  return new;
end;
$$;
revoke execute on function public.vendors_inactive_stamp() from public, anon, authenticated;
drop trigger if exists vendors_inactive_stamp on public.vendors;
create trigger vendors_inactive_stamp before insert or update of is_active on public.vendors for each row execute function public.vendors_inactive_stamp();

-- one card per inactive vendor at a time
create or replace function public.inactive_vendor_card(p_vendor uuid, p_why text, p_email uuid, p_order uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare v public.vendors%rowtype; e public.emails%rowtype; rid uuid;
begin
  select * into v from public.vendors where id = p_vendor;
  if not found or v.is_active or v.merged_into_id is not null then return null; end if;
  if p_email is not null then select * into e from public.emails where id = p_email; end if;
  select id into rid from public.review_items where kind = 'inactive_vendor' and entity_id = v.id and status = 'pending' limit 1;
  if rid is not null then
    update public.review_items set details = details || jsonb_build_object('more', coalesce((details->>'more')::int, 0) + 1) where id = rid;
    return rid;
  end if;
  insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
  values (v.organization_id, 'inactive_vendor', 'vendor', v.id,
          format('%s is inactive, but it looks like we may be ordering from them again', v.name),
          jsonb_build_object('vendor_id', v.id, 'vendor_name', v.name, 'vendor_id_for_rules', v.id, 'why', left(p_why, 300),
                             'email_id', p_email, 'thread_id', e.thread_id, 'order_id', p_order, 'inactive_reason', v.inactive_reason))
  returning id into rid;
  return rid;
end;
$$;
revoke execute on function public.inactive_vendor_card(uuid, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.inactive_vendor_card(uuid, text, uuid, uuid) to service_role;

create or replace function public.orders_inactive_vendor() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.vendor_id is not null and exists (select 1 from public.vendors v where v.id = new.vendor_id and not v.is_active) then
    perform public.inactive_vendor_card(new.vendor_id, format('An order was made in VMS%s', coalesce(' (PO ' || new.po_number || ')', '')), null, new.id);
  end if;
  return null;
end;
$$;
revoke execute on function public.orders_inactive_vendor() from public, anon, authenticated;
drop trigger if exists orders_inactive_vendor on public.orders;
create trigger orders_inactive_vendor after insert or update of vendor_id on public.orders for each row execute function public.orders_inactive_vendor();

/** Make active again, or keep inactive. */
create or replace function public.inactive_vendor_answer(p_item uuid, p_reactivate boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r public.review_items%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers decide this' using errcode = '42501'; end if;
  select * into r from public.review_items where id = p_item for update;
  if not found or not public.user_in_org(r.organization_id) or r.kind <> 'inactive_vendor' then raise exception 'Card not found' using errcode = '23503'; end if;
  if r.status <> 'pending' then return; end if;
  if p_reactivate then
    update public.vendors set is_active = true where id = r.entity_id and organization_id = r.organization_id;
    insert into public.activity_log (organization_id, entity_type, entity_id, action, details, actor_id)
    values (r.organization_id, 'vendor', r.entity_id, 'reactivated', jsonb_build_object('from', 'inactive_vendor card', 'why', r.details->>'why'), auth.uid());
  end if;
  update public.review_items set status = case when p_reactivate then 'accepted'::public.review_status else 'rejected'::public.review_status end,
         resolved_by = auth.uid(), resolved_at = now(), resolution_note = case when p_reactivate then 'Made active again' else 'Kept inactive' end
   where id = p_item;
end;
$$;
revoke execute on function public.inactive_vendor_answer(uuid, boolean) from public, anon;
grant execute on function public.inactive_vendor_answer(uuid, boolean) to authenticated;

-- each email looked at once
create table if not exists public.inactive_vendor_mail (
  email_id         uuid primary key references public.emails(id) on delete cascade,
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  vendor_id        uuid not null references public.vendors(id) on delete cascade,
  ordering         boolean,
  why              text,
  read_at          timestamptz,
  created_at       timestamptz not null default now()
);
comment on table public.inactive_vendor_mail is 'orders@ mail that may involve an inactive vendor, read once by Claude: does it show us ordering or looking into ordering?';
alter table public.inactive_vendor_mail enable row level security;
drop policy if exists "inactive_vendor_mail: members read" on public.inactive_vendor_mail;
create policy "inactive_vendor_mail: members read" on public.inactive_vendor_mail for select to authenticated using (public.user_in_org(organization_id));
grant select on public.inactive_vendor_mail to authenticated;
grant all on public.inactive_vendor_mail to service_role;

/**
 * New shared mail (last 3 days, after the vendor went inactive) that involves an inactive vendor: filed or tagged to it,
 * from or to one of its contacts, from its sender, or naming it (a name of two or more words). Queued once per email.
 */
create or replace function public.inactive_vendor_mail_find(p_org uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with v as (
    select x.id, x.inactive_at, phraseto_tsquery('simple', public.name_words(x.name)) q, array_length(regexp_split_to_array(public.name_words(x.name), ' '), 1) words
      from public.vendors x where x.organization_id = p_org and not x.is_active and x.merged_into_id is null and not x.is_retail_store
  ), m as (
    select e.* from public.emails e left join public.email_threads t on t.id = e.thread_id
     where e.organization_id = p_org and e.received_at > now() - interval '3 days' and e.copy_of is null
       and (e.mailbox_id is null or t.shared_at is not null)
       and not exists (select 1 from public.inactive_vendor_mail i where i.email_id = e.id)
  ), hits as (
    select distinct on (m.id) m.id email_id, v.id vendor_id
      from m join v on m.received_at > coalesce(v.inactive_at, '-infinity')
     where m.vendor_id = v.id
        or exists (select 1 from public.email_threads t where t.id = m.thread_id and t.tagged_vendor_ids @> array[v.id])
        or exists (select 1 from public.email_senders s where s.id = m.sender_id and s.vendor_id = v.id)
        or exists (select 1 from public.vendor_emails c where c.vendor_id = v.id and c.email is not null
                    and (lower(c.email) = lower(m.from_email) or lower(c.email) = any (m.to_emails) or lower(c.email) = any (m.cc_emails)))
        or (v.words >= 2 and m.search @@ v.q)
     order by m.id, (m.vendor_id = v.id) desc
  )
  insert into public.inactive_vendor_mail (email_id, organization_id, vendor_id)
  select h.email_id, p_org, h.vendor_id from hits h
  on conflict (email_id) do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.inactive_vendor_mail_find(uuid) from public, anon, authenticated;
grant execute on function public.inactive_vendor_mail_find(uuid) to service_role;

/** Claude's answer for one email; ordering makes (or adds to) the vendor's card. */
create or replace function public.inactive_vendor_mail_read(p_email uuid, p_ordering boolean, p_why text) returns uuid
language plpgsql security definer set search_path = public as $$
declare x public.inactive_vendor_mail%rowtype;
begin
  update public.inactive_vendor_mail set ordering = p_ordering, why = left(p_why, 300), read_at = now() where email_id = p_email returning * into x;
  if not found or not p_ordering then return null; end if;
  return public.inactive_vendor_card(x.vendor_id, p_why, p_email, null);
end;
$$;
revoke execute on function public.inactive_vendor_mail_read(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.inactive_vendor_mail_read(uuid, boolean, text) to service_role;
