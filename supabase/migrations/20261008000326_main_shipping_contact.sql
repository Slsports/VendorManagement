-- 0326 — Main shipping contact (Dana, Nov 9: "Add to contacts a button for Make main shipping contact and list below the
-- alternate main rep").
--   • vendors.main_shipping_contact_id: one of the vendor's own people, picked with Make main shipping contact. Listed
--     under the main rep and the alternate in Reps & contacts and at the top of the vendor page.
--   • Picking someone ticks Shipping on them if it wasn't. Someone marked former (or deleted) is no longer it.
set local lock_timeout = '5s';

alter table public.vendors add column if not exists main_shipping_contact_id uuid references public.vendor_emails(id) on delete set null;
comment on column public.vendors.main_shipping_contact_id is 'Our main shipping contact, one of the vendor''s own people: listed under the alternate rep (Dana, Nov 9).';

-- the main shipping contact is a shipping contact: tick Shipping on them
create or replace function public.vendors_main_shipping_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.main_shipping_contact_id is not null and new.main_shipping_contact_id is distinct from old.main_shipping_contact_id then
    update public.vendor_emails set roles = array(select distinct x from unnest(coalesce(roles, array[contact_type]) || 'shipping'::public.contact_type) x)
     where id = new.main_shipping_contact_id and vendor_id = new.id and not ('shipping' = any (coalesce(roles, array[contact_type])));
  end if;
  return null;
end;
$$;
revoke execute on function public.vendors_main_shipping_role() from public, anon, authenticated;
drop trigger if exists vendors_main_shipping_role on public.vendors;
create trigger vendors_main_shipping_role after update of main_shipping_contact_id on public.vendors
  for each row execute function public.vendors_main_shipping_role();

-- someone who has left is no longer the main shipping contact
create or replace function public.contacts_former_not_main_shipping() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.former_at is not null and old.former_at is null then
    update public.vendors set main_shipping_contact_id = null where main_shipping_contact_id = new.id;
  end if;
  return null;
end;
$$;
revoke execute on function public.contacts_former_not_main_shipping() from public, anon, authenticated;
drop trigger if exists vendor_emails_former_not_main_shipping on public.vendor_emails;
create trigger vendor_emails_former_not_main_shipping after update of former_at on public.vendor_emails
  for each row execute function public.contacts_former_not_main_shipping();
