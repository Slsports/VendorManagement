-- 0060 — Bulk upload of freight bills (Dana, Oct 9): drop a batch of PartnerShip, UPS DIRECT, WWD… bill PDFs.
-- Claude reads each one, including the billing company and our UPS account number printed on it, which
-- decides the billing company (2K229F WWEX, V513K4 PartnerShip, 89787W UPS DIRECT). A PDF whose bill is
-- already waiting (PartnerShip emails without the PDF) fills that bill; one already on file is skipped.
-- PartnerShip's "Your New Invoices" emails list invoice number, date, due date and balance: read now.

-- The waiting PartnerShip bills: invoice number, dates and amount from their email.
update public.freight_bills b set
  invoice_number = coalesce(b.invoice_number, (regexp_match(e.body_text, '\m(PS\d{6,})\M'))[1]),
  invoice_date = coalesce(to_date((regexp_match(e.body_text, 'PS\d{6,}\s*\n?\s*(\d{2}/\d{2}/\d{4})'))[1], 'MM/DD/YYYY'), b.invoice_date),
  due_date = coalesce(b.due_date, to_date((regexp_match(e.body_text, 'PS\d{6,}\s*\n?\s*\d{2}/\d{2}/\d{4}\s*\n?\s*(\d{2}/\d{2}/\d{4})'))[1], 'MM/DD/YYYY')),
  total = coalesce(b.total, replace((regexp_match(e.body_text, 'Total Balance:\s*\$([0-9,]+\.\d{2})'))[1], ',', '')::numeric)
  from public.emails e
 where e.id = b.email_id and b.storage_path is null and e.body_text ~ '\mPS\d{6,}\M';

-- An uploaded PDF (the browser stored it); freight-read reads it next.
create or replace function public.create_uploaded_freight_bill(p_path text, p_file text, p_carrier uuid default null)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_user_org();
  v_id  uuid;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers add freight bills' using errcode = '42501'; end if;
  if p_path is null or split_part(p_path, '/', 1) <> v_org::text then raise exception 'Upload the file first' using errcode = '22023'; end if;
  insert into public.freight_bills (organization_id, carrier_id, storage_path, file_name, status)
  values (v_org, p_carrier, p_path, p_file, 'reading') returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.create_uploaded_freight_bill(text, text, uuid) from public, anon;
grant execute on function public.create_uploaded_freight_bill(text, text, uuid) to authenticated, service_role;

-- After reading: the billing company from our UPS number or its name, then fill a waiting bill or skip a
-- duplicate. Returns 'new', 'filled', 'duplicate' or 'no_carrier'.
create or replace function public.freight_bill_settle(p_bill uuid, p_ups text, p_company text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  b      public.freight_bills%rowtype;
  v_c    uuid;
  o      public.freight_bills%rowtype;
begin
  select * into b from public.freight_bills where id = p_bill for update;
  if b.id is null then return 'missing'; end if;
  if b.carrier_id is null then
    select id into v_c from public.carriers
     where organization_id = b.organization_id and role = 'billing' and ups_account is not null
       and upper(regexp_replace(ups_account, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(coalesce(p_ups, ''), '[^A-Za-z0-9]', '', 'g'))
     limit 1;
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
      -- The waiting bill (from the email) takes the PDF and what Claude read.
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
revoke execute on function public.freight_bill_settle(uuid, text, text) from public, anon, authenticated;
grant execute on function public.freight_bill_settle(uuid, text, text) to service_role;
