-- 0310 — Alternate rep (Dana, Nov 5, 2026): "Tim Parratto ... should be listed as the main alternate". Each vendor has a main
-- rep (who we order through and who gets the follow-ups) and now an alternate: shown under the main rep at the top of the
-- vendor page and on the order's Reps box. VMS never copies the alternate on its emails (Dana: "no need to copy to tim. If we
-- don't get a response we will know to send something to tim").
--   • vendors.alternate_rep_contact_id (the vendor's own person) or vendors.alternate_rep_group_contact_id (someone at its
--     rep group); one of the two, never the same person as the main rep.
--   • A person marked former or deleted is no longer the alternate; making the alternate the main rep clears the alternate.
--   • Carey On Sports: Tim Parratto is the alternate on SMITH OPTICS - SUNCLOUD OPTICS and CHAOS (Shannon is main).

set local lock_timeout = '5s';

alter table public.vendors add column if not exists alternate_rep_contact_id uuid references public.vendor_emails(id) on delete set null;
alter table public.vendors add column if not exists alternate_rep_group_contact_id uuid references public.rep_group_contacts(id) on delete set null;
comment on column public.vendors.alternate_rep_contact_id is 'Our alternate rep, one of the vendor''s own people: shown under the main rep, never copied on VMS emails (Dana, Nov 5).';
comment on column public.vendors.alternate_rep_group_contact_id is 'Our alternate rep at the vendor''s rep group (Tim Parratto at Carey On Sports for Smith, Dana Nov 5).';

-- one alternate, never the main rep
create or replace function public.vendors_alternate_rep_clean() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.alternate_rep_contact_id is not null and new.alternate_rep_group_contact_id is not null then
    -- the one just picked wins
    if new.alternate_rep_contact_id is distinct from old.alternate_rep_contact_id then new.alternate_rep_group_contact_id := null;
    else new.alternate_rep_contact_id := null; end if;
  end if;
  if new.alternate_rep_contact_id is not null and new.alternate_rep_contact_id = new.assigned_rep_contact_id then new.alternate_rep_contact_id := null; end if;
  if new.alternate_rep_group_contact_id is not null and new.alternate_rep_group_contact_id = new.assigned_rep_group_contact_id then new.alternate_rep_group_contact_id := null; end if;
  return new;
end;
$$;
drop trigger if exists vendors_alternate_rep_clean on public.vendors;
create trigger vendors_alternate_rep_clean before insert or update of alternate_rep_contact_id, alternate_rep_group_contact_id, assigned_rep_contact_id, assigned_rep_group_contact_id
  on public.vendors for each row execute function public.vendors_alternate_rep_clean();

-- someone who has left is no longer the alternate
create or replace function public.contacts_former_not_alternate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.former_at is not null and old.former_at is null then
    if tg_table_name = 'vendor_emails' then
      update public.vendors set alternate_rep_contact_id = null where alternate_rep_contact_id = new.id;
    else
      update public.vendors set alternate_rep_group_contact_id = null where alternate_rep_group_contact_id = new.id;
    end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.contacts_former_not_alternate() from public, anon, authenticated;
drop trigger if exists vendor_emails_former_not_alternate on public.vendor_emails;
create trigger vendor_emails_former_not_alternate after update of former_at on public.vendor_emails
  for each row execute function public.contacts_former_not_alternate();
drop trigger if exists rep_group_contacts_former_not_alternate on public.rep_group_contacts;
create trigger rep_group_contacts_former_not_alternate after update of former_at on public.rep_group_contacts
  for each row execute function public.contacts_former_not_alternate();

-- Tim Parratto is the alternate on Carey On Sports' vendors
update public.vendors v set alternate_rep_group_contact_id = c.id
  from public.rep_group_contacts c join public.rep_groups g on g.id = c.rep_group_id
 where g.name = 'Carey On Sports' and lower(c.email) = 'tim@careyonsports.com' and v.rep_group_id = g.id and v.merged_into_id is null;
