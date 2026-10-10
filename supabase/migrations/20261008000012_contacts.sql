-- 0033 — Several reps per rep group and per vendor; our assigned rep; who took the order (Dana, Oct 8).
-- "Some rep groups have several reps … some vendors send certain reps to the shows when we have another
-- rep … tag the rep that is our actual assigned rep … the rep at the show will take our order, but the
-- follow-up is all done with our assigned rep."

-- Rep groups: any number of people. The old single contact becomes the first one.
create table if not exists public.rep_group_contacts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete restrict,
  rep_group_id     uuid not null references public.rep_groups(id) on delete cascade,
  name             text,
  title            text,
  email            text check (email is null or position('@' in email) > 1),
  phone            text,
  notes            text,
  created_at       timestamptz not null default now(),
  constraint rep_group_contacts_something check (coalesce(nullif(trim(name), ''), nullif(trim(email), ''), nullif(trim(phone), '')) is not null)
);
create index if not exists rep_group_contacts_group_idx on public.rep_group_contacts (rep_group_id);
create index if not exists rep_group_contacts_email_idx on public.rep_group_contacts (organization_id, lower(email));
comment on table public.rep_group_contacts is 'The people at a rep group. Mail from any of their addresses is that rep group.';

insert into public.rep_group_contacts (organization_id, rep_group_id, name, email, phone)
select g.organization_id, g.id, nullif(trim(g.contact_name), ''), nullif(trim(g.email), ''), nullif(trim(g.phone), '')
  from public.rep_groups g
 where coalesce(nullif(trim(g.contact_name), ''), nullif(trim(g.email), ''), nullif(trim(g.phone), '')) is not null
   and not exists (select 1 from public.rep_group_contacts c where c.rep_group_id = g.id);

-- Set organization_id from the rep group so the browser need not send it.
create or replace function public.rep_group_contacts_set_org()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  select organization_id into new.organization_id from public.rep_groups where id = new.rep_group_id;
  return new;
end;
$$;
drop trigger if exists rep_group_contacts_set_org on public.rep_group_contacts;
create trigger rep_group_contacts_set_org before insert or update of rep_group_id on public.rep_group_contacts
  for each row execute function public.rep_group_contacts_set_org();
revoke execute on function public.rep_group_contacts_set_org() from public, anon, authenticated;

alter table public.rep_group_contacts enable row level security;
drop policy if exists "rep_group_contacts: members read" on public.rep_group_contacts;
drop policy if exists "rep_group_contacts: editors write" on public.rep_group_contacts;
create policy "rep_group_contacts: members read" on public.rep_group_contacts for select to authenticated using (public.user_in_org(organization_id));
create policy "rep_group_contacts: editors write" on public.rep_group_contacts for all to authenticated
  using (public.user_can_edit() and public.user_in_org(organization_id)) with check (public.user_can_edit() and public.user_in_org(organization_id));
grant select, insert, update, delete on table public.rep_group_contacts to authenticated;
grant all on table public.rep_group_contacts to service_role;

-- Vendor contacts may have no email (a show rep with only a phone number).
alter table public.vendor_emails alter column email drop not null;
alter table public.vendor_emails drop constraint if exists vendor_emails_email_check;
alter table public.vendor_emails add constraint vendor_emails_email_check check (email is null or position('@' in email) > 1);
alter table public.vendor_emails drop constraint if exists vendor_emails_something;
alter table public.vendor_emails add constraint vendor_emails_something check (coalesce(nullif(trim(contact_name), ''), nullif(trim(email), ''), nullif(trim(phone), '')) is not null);

-- Our assigned rep: one of the vendor's own contacts, or one of its rep group's people.
alter table public.vendors add column if not exists assigned_rep_contact_id uuid references public.vendor_emails(id) on delete set null;
alter table public.vendors add column if not exists assigned_rep_group_contact_id uuid references public.rep_group_contacts(id) on delete set null;
alter table public.vendors drop constraint if exists vendors_one_assigned_rep;
alter table public.vendors add constraint vendors_one_assigned_rep check (assigned_rep_contact_id is null or assigned_rep_group_contact_id is null);
comment on column public.vendors.assigned_rep_contact_id is 'Our assigned rep (follow-ups go to them), when it is one of the vendor''s own contacts.';
comment on column public.vendors.assigned_rep_group_contact_id is 'Our assigned rep, when it is someone at the vendor''s rep group.';

-- The old single "Rep" on the vendor becomes a contact, starred as our rep.
with moved as (
  insert into public.vendor_emails (organization_id, vendor_id, email, contact_name, phone, contact_type, source)
  select v.organization_id, v.id, nullif(lower(trim(v.rep_email)), ''), nullif(trim(v.rep_name), ''), nullif(trim(v.rep_phone), ''), 'rep', 'manual'
    from public.vendors v
   where coalesce(nullif(trim(v.rep_name), ''), nullif(trim(v.rep_email), ''), nullif(trim(v.rep_phone), '')) is not null
     and not exists (
       select 1 from public.vendor_emails e where e.vendor_id = v.id
          and (lower(e.email) = lower(trim(v.rep_email)) or lower(trim(e.contact_name)) = lower(trim(v.rep_name))))
  returning id, vendor_id
)
update public.vendors v set assigned_rep_contact_id = m.id from moved m where v.id = m.vendor_id and v.assigned_rep_contact_id is null;
comment on column public.vendors.rep_name is 'Retired Oct 8 2026: moved to vendor_emails (the vendor''s contacts); see assigned_rep_contact_id.';

-- Who took the order: often a show rep, not our assigned rep.
alter table public.orders add column if not exists taken_by text;
comment on column public.orders.taken_by is 'The rep who wrote the order (e.g. at a show). Follow-ups still go to the vendor''s assigned rep.';

-- Mail: a sender writing from any rep group person's address (or their company domain) is that rep group.
create or replace function public.mail_match_rep_senders(p_org uuid, p_sender_ids uuid[] default null)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  r        record;
  e        record;
  v_count  integer := 0;
begin
  for r in
    with addrs as (
      select g.id as rep_group_id, g.name as rep_name, lower(trim(g.email)) as email
        from public.rep_groups g where g.organization_id = p_org and g.is_active and g.email is not null
      union
      select g.id, g.name, lower(trim(c.email))
        from public.rep_group_contacts c join public.rep_groups g on g.id = c.rep_group_id and g.is_active
       where c.organization_id = p_org and c.email is not null
    )
    select distinct on (s.id) s.id as sender_id, s.review_item_id, a.rep_group_id, a.rep_name
      from public.email_senders s
      join addrs a on (not s.is_domain and s.sender_key = a.email)
                   or (s.is_domain and s.sender_key = public.mail_domain(a.email) and not public.mail_is_freemail(public.mail_domain(a.email)))
     where s.organization_id = p_org and s.kind = 'unknown'
       and (p_sender_ids is null or s.id = any (p_sender_ids))
     order by s.id, a.rep_name
  loop
    update public.email_senders set kind = 'rep_group', rep_group_id = r.rep_group_id, decided_at = now() where id = r.sender_id;
    update public.review_items set status = 'accepted', resolved_at = now(), resolution_note = 'Known rep group: ' || r.rep_name
     where id = r.review_item_id and status = 'pending';
    for e in select id, thread_id from public.emails where sender_id = r.sender_id and vendor_id is null loop
      perform public.mail_link_email(e.id);
      perform public.mail_refresh_thread(e.thread_id, false);
    end loop;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke execute on function public.mail_match_rep_senders(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.mail_match_rep_senders(uuid, uuid[]) to service_role;

-- A new rep group person's address files their waiting mail at once.
create or replace function public.rep_group_contact_match_mail()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.email is not null then
    perform public.mail_match_rep_senders(new.organization_id,
      (select array_agg(s.id) from public.email_senders s
        where s.organization_id = new.organization_id and s.kind = 'unknown'
          and (s.sender_key = lower(trim(new.email)) or s.sender_key = public.mail_domain(new.email))));
  end if;
  return new;
end;
$$;
drop trigger if exists rep_group_contacts_match_mail on public.rep_group_contacts;
create trigger rep_group_contacts_match_mail after insert or update of email on public.rep_group_contacts
  for each row execute function public.rep_group_contact_match_mail();
revoke execute on function public.rep_group_contact_match_mail() from public, anon, authenticated;
