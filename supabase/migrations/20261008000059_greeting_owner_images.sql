-- 0080 — Two small ones (Dana, Oct 10).
-- 1. "If it says Dear Dana, or Hi Jarrett": an incoming email that greets one of us by first name goes to that
--    person's mail, even when the vendor is normally someone else's. Claude reads the greeting with the reply check.
-- 2. "We need an images folder": vendor documents get an Images folder (kind image).
alter table public.vendor_links drop constraint if exists vendor_links_kind_check;
alter table public.vendor_links add constraint vendor_links_kind_check check (kind in ('catalog', 'price_list', 'order_form', 'specials', 'website', 'other',
  'invoice', 'credit', 'confirmation', 'order', 'ls_po', 'packing_slip', 'payment', 'freight_bill', 'delivery_receipt', 'image'));

create or replace function public.mail_apply_greeting(p_email uuid, p_name text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  e     public.emails%rowtype;
  v_who uuid;
  v_n   integer;
begin
  select * into e from public.emails where id = p_email;
  if e.id is null or e.direction <> 'in' or coalesce(trim(p_name), '') = '' then return null; end if;
  -- one active person whose first name it is (Claude's test login never)
  select min(id::text)::uuid, count(*) into v_who, v_n from public.profiles
   where organization_id = e.organization_id and is_active and email not ilike 'claude-test@%'
     and split_part(lower(trim(full_name)), ' ', 1) = lower(trim(p_name));
  if v_n <> 1 then return null; end if;
  update public.email_threads set owner_id = v_who, owner_set_at = now() where id = e.thread_id and owner_id is distinct from v_who;
  return v_who;
end;
$$;
revoke execute on function public.mail_apply_greeting(uuid, text) from public, anon, authenticated;
grant execute on function public.mail_apply_greeting(uuid, text) to service_role;
