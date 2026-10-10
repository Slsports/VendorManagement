-- 0022 — Email beside every phone on the vendor (Dana, 2026-10-08: "anywhere that there is contact
-- information, I want an email; that's how we do most of our orders").
-- Three plain fields next to the phones: the vendor's orders email, the rep's email and the shipping
-- contact's email. Each address is also copied into vendor_emails (the contact list) so the Gmail
-- connection recognises mail from it; old addresses stay there as history when a field changes.

alter table public.vendors add column if not exists email text;
alter table public.vendors add column if not exists rep_email text;
alter table public.vendors add column if not exists shipping_contact_email text;
comment on column public.vendors.email is 'Where orders go: the vendor''s orders / customer service email.';
comment on column public.vendors.rep_email is 'The individual rep''s email (rep_name, rep_phone).';
comment on column public.vendors.shipping_contact_email is 'The shipping contact''s email.';

do $$ begin
  alter table public.vendors add constraint vendors_email_check check (email is null or position('@' in email) > 1);
  alter table public.vendors add constraint vendors_rep_email_check check (rep_email is null or position('@' in rep_email) > 1);
  alter table public.vendors add constraint vendors_shipping_contact_email_check check (shipping_contact_email is null or position('@' in shipping_contact_email) > 1);
exception when duplicate_object then null; end $$;

create or replace function public.vendor_emails_from_fields()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.email is not null and new.email is distinct from (case when tg_op = 'UPDATE' then old.email end) then
    insert into public.vendor_emails (vendor_id, email, contact_type, source)
    values (new.id, lower(trim(new.email)), 'orders', 'manual') on conflict do nothing;
  end if;
  if new.rep_email is not null and new.rep_email is distinct from (case when tg_op = 'UPDATE' then old.rep_email end) then
    insert into public.vendor_emails (vendor_id, email, contact_name, phone, contact_type, source)
    values (new.id, lower(trim(new.rep_email)), new.rep_name, new.rep_phone, 'rep', 'manual') on conflict do nothing;
  end if;
  if new.shipping_contact_email is not null and new.shipping_contact_email is distinct from (case when tg_op = 'UPDATE' then old.shipping_contact_email end) then
    insert into public.vendor_emails (vendor_id, email, contact_name, phone, contact_type, source)
    values (new.id, lower(trim(new.shipping_contact_email)), new.shipping_contact, new.shipping_contact_phone, 'shipping', 'manual') on conflict do nothing;
  end if;
  return null;
end;
$$;
drop trigger if exists vendors_emails_from_fields on public.vendors;
create trigger vendors_emails_from_fields after insert or update of email, rep_email, shipping_contact_email on public.vendors
  for each row execute function public.vendor_emails_from_fields();
