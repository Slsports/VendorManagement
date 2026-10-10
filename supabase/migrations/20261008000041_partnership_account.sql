-- 0062 — PartnerShip's bills show no UPS number of ours, only "PartnerShip Account # 792862" (Dana, Oct 9):
-- it is saved as our account with them, and uploaded bills match a billing company by our UPS number or
-- our account number with them.
update public.carriers set account_number = '792862' where name = 'PartnerShip' and account_number is null;

drop function if exists public.freight_bill_settle(uuid, text, text);
create or replace function public.freight_bill_settle(p_bill uuid, p_ups text, p_company text, p_account text default null)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  b      public.freight_bills%rowtype;
  v_c    uuid;
  o      public.freight_bills%rowtype;
  k      text;
begin
  select * into b from public.freight_bills where id = p_bill for update;
  if b.id is null then return 'missing'; end if;
  if b.carrier_id is null then
    -- our UPS number (2K229F, 89787W…) or our account with them (W0003290195, 792862)
    for k in select upper(regexp_replace(x, '[^A-Za-z0-9]', '', 'g')) from unnest(array[p_ups, p_account]) x where nullif(trim(x), '') is not null loop
      select id into v_c from public.carriers
       where organization_id = b.organization_id and role = 'billing'
         and (upper(regexp_replace(coalesce(ups_account, ''), '[^A-Za-z0-9]', '', 'g')) = k or upper(regexp_replace(coalesce(account_number, ''), '[^A-Za-z0-9]', '', 'g')) = k)
       limit 1;
      exit when v_c is not null;
    end loop;
    if v_c is null and nullif(trim(p_company), '') is not null then
      select id into v_c from public.carriers c
       where c.organization_id = b.organization_id and c.role = 'billing'
         and (lower(p_company) like '%' || lower(split_part(c.name, ' (', 1)) || '%'
              or lower(c.name) like '%' || lower(trim(p_company)) || '%'
              or (lower(p_company) like '%worldwide express%' and c.name ilike 'Worldwide Express%')
              or (lower(p_company) ~ 'worldwide (distributors|buying)' and c.name ilike 'Worldwide Distributors%'))
       order by length(c.name) limit 1;
    end if;
    if v_c is null then
      update public.freight_bills set status = 'failed', read_note = 'Which billing company sent it? Pick it on the bill.' where id = p_bill;
      return 'no_carrier';
    end if;
    update public.freight_bills set carrier_id = v_c where id = p_bill;
    b.carrier_id := v_c;
  end if;

  if public.inv_key(b.invoice_number) is not null then
    select * into o from public.freight_bills
     where organization_id = b.organization_id and id <> b.id and carrier_id = b.carrier_id and public.inv_key(invoice_number) = public.inv_key(b.invoice_number)
     order by (storage_path is null) desc, created_at limit 1;
    if o.id is not null and o.storage_path is null then
      update public.freight_bill_lines set bill_id = o.id where bill_id = b.id;
      update public.freight_bills set storage_path = b.storage_path, file_name = b.file_name, status = b.status, read_note = b.read_note, read_at = b.read_at,
             invoice_date = coalesce(b.invoice_date, o.invoice_date), due_date = coalesce(b.due_date, o.due_date), total = coalesce(b.total, o.total), fee_amount = b.fee_amount
       where id = o.id;
      delete from public.freight_bills where id = b.id;
      return 'filled:' || o.id;
    elsif o.id is not null then
      delete from public.freight_bills where id = b.id;
      return 'duplicate:' || o.id;
    end if;
  end if;
  return 'new';
end;
$$;
revoke execute on function public.freight_bill_settle(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.freight_bill_settle(uuid, text, text, text) to service_role;
