-- 0288 — A corrected freight bill wins (Dana, Nov 3: "Newer email should win throughout VMS"; "go 1-4 & 6"). 0287 dropped
-- any second bill with the same billing company and invoice number and kept the one on file. When the newer one is a
-- corrected bill (both have a PDF and the totals differ), the newer one now replaces it: the kept bill takes the new PDF,
-- total, dates and shipments (shipments already confirmed on it stay, never twice), keeps its payment, notes what was
-- replaced, and is matched again. An exact copy (same total) is still just dropped.
set local lock_timeout = '5s';

create or replace function public.freight_bill_settle(p_bill uuid, p_ups text, p_company text, p_account text default null::text)
returns text language plpgsql security definer set search_path = public as $$
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
    if o.id is not null then
      -- a corrected bill: both have a PDF and the totals differ → the newer one wins
      if o.storage_path is not null and b.storage_path is not null and b.total is not null and o.total is not null and b.total <> o.total then
        delete from public.freight_bill_lines where bill_id = o.id and not confirmed;
        delete from public.freight_bill_lines bl where bl.bill_id = b.id and exists (
          select 1 from public.freight_bill_lines ol where ol.bill_id = o.id and ol.confirmed
             and lower(trim(coalesce(ol.shipper_name, ''))) = lower(trim(coalesce(bl.shipper_name, ''))) and ol.ship_date is not distinct from bl.ship_date);
        update public.freight_bill_lines set bill_id = o.id where bill_id = b.id;
        update public.vendor_payments set freight_bill_id = o.id where freight_bill_id = b.id;
        update public.dropbox_files set freight_bill_id = o.id where freight_bill_id = b.id;
        delete from public.freight_bills where id = b.id;
        update public.freight_bills set
               storage_path = b.storage_path, file_name = b.file_name, total = b.total, fee_amount = b.fee_amount,
               invoice_date = coalesce(b.invoice_date, o.invoice_date), due_date = coalesce(b.due_date, o.due_date),
               email_id = coalesce(b.email_id, o.email_id), source_attachment_id = coalesce(b.source_attachment_id, o.source_attachment_id),
               dropbox_path = coalesce(b.dropbox_path, o.dropbox_path), read_at = b.read_at,
               read_note = 'Corrected bill (' || coalesce(b.file_name, 'new PDF') || ', $' || b.total || ') replaced the earlier one (' || coalesce(o.file_name, 'PDF') || ', $' || o.total || ') on ' || to_char(now() at time zone 'America/Los_Angeles', 'Mon DD, YYYY') || '.'
         where id = o.id;
        perform public.freight_bill_loaded(o.id);
        return 'corrected:' || o.id;
      end if;
      -- otherwise the copy goes; what points at it and where it came from move to the bill that is kept (a waiting bill with
      -- no PDF also takes the copy's PDF and lines). email_id is unique, so the copy is deleted before the kept bill takes it.
      if o.storage_path is null then
        update public.freight_bill_lines set bill_id = o.id where bill_id = b.id;
      end if;
      update public.vendor_payments set freight_bill_id = o.id where freight_bill_id = b.id;
      update public.dropbox_files set freight_bill_id = o.id where freight_bill_id = b.id;
      delete from public.freight_bills where id = b.id;
      update public.freight_bills set
             email_id = coalesce(o.email_id, b.email_id),
             source_attachment_id = coalesce(o.source_attachment_id, b.source_attachment_id),
             dropbox_path = coalesce(o.dropbox_path, b.dropbox_path)
       where id = o.id;
      if o.storage_path is null then
        update public.freight_bills set storage_path = b.storage_path, file_name = b.file_name, status = b.status, read_note = b.read_note, read_at = b.read_at,
               invoice_date = coalesce(b.invoice_date, o.invoice_date), due_date = coalesce(b.due_date, o.due_date), total = coalesce(b.total, o.total), fee_amount = b.fee_amount
         where id = o.id;
        return 'filled:' || o.id;
      end if;
      return 'duplicate:' || o.id;
    end if;
  end if;
  return 'new';
end;
$$;
revoke execute on function public.freight_bill_settle(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.freight_bill_settle(uuid, text, text, text) to service_role;
