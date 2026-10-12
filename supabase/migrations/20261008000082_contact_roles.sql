-- 0103 — A contact can be several things at once (Dana, Oct 12: "I thought we had it set up so that we could check the box
-- of the contact, like Rep, Owner…"; Barry at Royal Deluxe is the rep and the owner). vendor_emails.roles holds every
-- kind; contact_type stays as the main one (Rep first) for the code that reads it.

alter table public.vendor_emails add column if not exists roles public.contact_type[] not null default '{}';
update public.vendor_emails set roles = array[contact_type] where roles = '{}';
comment on column public.vendor_emails.roles is 'Every kind this contact is (Rep, Owner, Orders…); contact_type is the main one, Rep first.';

create or replace function public.vendor_emails_roles() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(array_length(new.roles, 1), 0) = 0 then
    new.roles := array[new.contact_type];
  elsif tg_op = 'UPDATE' and new.contact_type is distinct from old.contact_type and new.roles = old.roles then
    -- only the main kind changed (older code): keep the others
    new.roles := array(select distinct x from unnest(array[new.contact_type] || old.roles) x);
  end if;
  new.contact_type := (select x from unnest(new.roles) x
                        order by array_position(array['rep', 'orders', 'owner', 'ap', 'customer_service', 'shipping', 'other']::public.contact_type[], x) limit 1);
  return new;
end;
$$;
drop trigger if exists vendor_emails_roles on public.vendor_emails;
create trigger vendor_emails_roles before insert or update on public.vendor_emails for each row execute function public.vendor_emails_roles();
