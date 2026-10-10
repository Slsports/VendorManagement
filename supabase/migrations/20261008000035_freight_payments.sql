-- 0056 — Freight payments (Dana, Oct 8). A bill gets marked paid from:
--  * a carrier's payment receipt (Priority1 "Payment ACH Success Receipt"): Claude reads it, the receipt is
--    kept on the bill;
--  * our own email saying it is paid ("This order was paid by ACH 10/8/26 by Dana"): Claude reads it.
-- The bill is found by invoice number, else the only unpaid bill of that carrier for that amount, else the
-- bill the conversation is about; otherwise a "which bill?" card goes to the review queue.
-- Also: "Make a freight bill" from any PDF in an email (the sync fetches and reads it), and the vendor's copy
-- of a bill goes on the matched order too.
alter table public.freight_bills add column if not exists paid_source text check (paid_source in ('manual', 'receipt', 'email'));
alter table public.freight_bills add column if not exists paid_email_id uuid references public.emails(id) on delete set null;
alter table public.freight_bills add column if not exists receipt_path text;
alter table public.freight_bills add column if not exists receipt_file_name text;
alter table public.freight_bills add column if not exists source_attachment_id uuid references public.email_attachments(id) on delete set null;
comment on column public.freight_bills.source_attachment_id is 'Made by hand from a PDF in an email; gmail-sync fetches and reads it.';
alter table public.emails add column if not exists paid_read_at timestamptz;
comment on column public.emails.paid_read_at is 'When Claude read this email for a freight payment (a receipt, or our "it is paid").';

create or replace function public.inv_key(p text) returns text language sql immutable as $$
  select nullif(regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]', '', 'g'), '')
$$;

-- What Claude read about a payment, applied. Returns 'paid', 'review' or 'duplicate'.
create or replace function public.freight_apply_payment(
  p_org uuid, p_carrier uuid, p_email uuid, p_source text, p_amount numeric, p_date date, p_via text, p_ref text,
  p_invoices text[], p_payer text, p_receipt_path text, p_receipt_file text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  v_bills  uuid[];
  v_bill   uuid;
  v_thread uuid;
  v_by     uuid;
  v_carrier uuid := p_carrier;
  v_via    text := case when p_via in ('card', 'check', 'ach', 'billcom', 'other') then p_via end;
  v_by_inv boolean := false;
  n        integer := 0;
begin
  select thread_id, sent_by into v_thread, v_by from public.emails where id = p_email;
  if v_carrier is null then select carrier_id into v_carrier from public.email_threads where id = v_thread; end if;
  -- Who paid: the sender from VMS, else a first name in the text ("by Dana").
  if v_by is null and nullif(trim(p_payer), '') is not null then
    select id into v_by from public.profiles where organization_id = p_org and is_active
       and lower(split_part(full_name, ' ', 1)) = lower(split_part(trim(p_payer), ' ', 1)) limit 1;
  end if;

  -- 1. invoice numbers named
  if cardinality(p_invoices) > 0 then
    select array_agg(b.id) into v_bills from public.freight_bills b
     where b.organization_id = p_org and public.inv_key(b.invoice_number) = any (select public.inv_key(x) from unnest(p_invoices) x);
    v_by_inv := coalesce(cardinality(v_bills), 0) > 0;
  end if;
  -- 2. the bill this conversation is about
  if coalesce(cardinality(v_bills), 0) = 0 and v_thread is not null then
    select array_agg(b.id) into v_bills from public.freight_bills b join public.emails e on e.id = b.email_id
     where b.organization_id = p_org and e.thread_id = v_thread;
  end if;
  -- 3. the only unpaid bill of this carrier for this amount
  if coalesce(cardinality(v_bills), 0) = 0 and p_amount is not null then
    select array_agg(b.id) into v_bills from public.freight_bills b
     where b.organization_id = p_org and b.paid_date is null and (v_carrier is null or b.carrier_id = v_carrier) and b.total = p_amount;
  end if;

  -- One bill, or every bill a receipt names by number (one payment can pay several invoices).
  if cardinality(v_bills) = 1 or v_by_inv then
    foreach v_bill in array v_bills loop
      if exists (select 1 from public.freight_bills where id = v_bill and paid_email_id = p_email) then continue; end if;
      update public.freight_bills set
        paid_date = coalesce(paid_date, p_date, (select received_at::date from public.emails where id = p_email)),
        paid_via = coalesce(paid_via, v_via), paid_ref = coalesce(paid_ref, nullif(trim(p_ref), '')), paid_by = coalesce(paid_by, v_by),
        paid_source = coalesce(paid_source, p_source), paid_email_id = coalesce(paid_email_id, p_email),
        receipt_path = coalesce(p_receipt_path, receipt_path), receipt_file_name = coalesce(p_receipt_file, receipt_file_name)
       where id = v_bill;
      n := n + 1;
    end loop;
    return case when n > 0 then 'paid' else 'duplicate' end;
  end if;

  if not exists (select 1 from public.review_items where kind = 'freight_payment' and status = 'pending' and details->>'email_id' = p_email::text) then
    insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details, assigned_to, assigned_at)
    values (p_org, 'freight_payment', 'email', p_email,
            'Freight payment' || coalesce(' of $' || to_char(p_amount, 'FM999,990.00'), '') || ': which bill?',
            jsonb_build_object('email_id', p_email, 'thread_id', v_thread, 'carrier_id', v_carrier, 'carrier', (select name from public.carriers where id = v_carrier),
                               'source', p_source, 'amount', p_amount, 'date', p_date, 'via', v_via, 'ref', p_ref, 'invoices', to_jsonb(coalesce(p_invoices, '{}')),
                               'payer_id', v_by, 'receipt_path', p_receipt_path, 'receipt_file', p_receipt_file),
            (select owner_id from public.carriers where id = v_carrier), now());
  end if;
  return 'review';
end;
$$;
revoke execute on function public.freight_apply_payment(uuid, uuid, uuid, text, numeric, date, text, text, text[], text, text, text) from public, anon, authenticated;
grant execute on function public.freight_apply_payment(uuid, uuid, uuid, text, numeric, date, text, text, text[], text, text, text) to service_role;

-- The review card: this payment paid that bill.
create or replace function public.answer_freight_payment(p_item uuid, p_bill uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  it public.review_items%rowtype;
  d  jsonb;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers mark bills paid' using errcode = '42501'; end if;
  select * into it from public.review_items where id = p_item for update;
  if it.id is null or it.kind <> 'freight_payment' or not public.user_in_org(it.organization_id) then raise exception 'Review item not found' using errcode = '23503'; end if;
  if not exists (select 1 from public.freight_bills where id = p_bill and organization_id = it.organization_id) then raise exception 'Freight bill not found' using errcode = '23503'; end if;
  d := it.details;
  update public.freight_bills set
    paid_date = coalesce(paid_date, nullif(d->>'date', '')::date, (select received_at::date from public.emails where id = it.entity_id)),
    paid_via = coalesce(paid_via, nullif(d->>'via', '')), paid_ref = coalesce(paid_ref, nullif(d->>'ref', '')),
    paid_by = coalesce(paid_by, nullif(d->>'payer_id', '')::uuid, auth.uid()), paid_source = coalesce(paid_source, d->>'source'),
    paid_email_id = coalesce(paid_email_id, it.entity_id),
    receipt_path = coalesce(nullif(d->>'receipt_path', ''), receipt_path), receipt_file_name = coalesce(nullif(d->>'receipt_file', ''), receipt_file_name)
   where id = p_bill;
  update public.review_items set status = 'accepted', resolved_by = auth.uid(), resolved_at = now(), resolution_note = 'Bill marked paid' where id = p_item;
end;
$$;
revoke execute on function public.answer_freight_payment(uuid, uuid) from public, anon;
grant execute on function public.answer_freight_payment(uuid, uuid) to authenticated, service_role;

-- "Make a freight bill" from a PDF in an email; the sync fetches it from Gmail and Claude reads it.
create or replace function public.make_freight_bill_from_attachment(p_attachment uuid, p_carrier uuid)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  a      public.email_attachments%rowtype;
  v_id   uuid;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers add freight bills' using errcode = '42501'; end if;
  select * into a from public.email_attachments where id = p_attachment;
  if a.id is null or not public.user_in_org(a.organization_id) then raise exception 'Attachment not found' using errcode = '23503'; end if;
  if not exists (select 1 from public.carriers where id = p_carrier and organization_id = a.organization_id) then raise exception 'Pick the carrier' using errcode = '22023'; end if;
  select id into v_id from public.freight_bills where source_attachment_id = p_attachment;
  if v_id is not null then return v_id; end if;
  insert into public.freight_bills (organization_id, carrier_id, email_id, file_name, status, source_attachment_id, invoice_date)
  values (a.organization_id, p_carrier,
          case when exists (select 1 from public.freight_bills where email_id = a.email_id) then null else a.email_id end,
          a.file_name, 'reading', p_attachment, (select received_at::date from public.emails where id = a.email_id))
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.make_freight_bill_from_attachment(uuid, uuid) from public, anon;
grant execute on function public.make_freight_bill_from_attachment(uuid, uuid) to authenticated, service_role;

-- The vendor's copy of a bill goes on the matched order too.
create or replace function public.freight_line_files_pdf()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  b public.freight_bills%rowtype;
begin
  if new.confirmed and new.vendor_id is not null then
    select * into b from public.freight_bills where id = new.bill_id;
    if b.storage_path is not null then
      if exists (select 1 from public.vendor_links where vendor_id = new.vendor_id and storage_path = b.storage_path) then
        update public.vendor_links set order_id = coalesce(order_id, new.order_id) where vendor_id = new.vendor_id and storage_path = b.storage_path;
      else
        insert into public.vendor_links (organization_id, vendor_id, order_id, kind, label, storage_path, file_name, source, email_id, received_at, notes)
        values (new.organization_id, new.vendor_id, new.order_id, 'freight_bill',
                'Freight bill ' || coalesce(b.invoice_number, ''), b.storage_path, b.file_name, 'email', b.email_id,
                coalesce(b.invoice_date, current_date), 'Freight bill from ' || coalesce((select name from public.carriers where id = b.carrier_id), 'a carrier'));
      end if;
    end if;
  end if;
  return null;
end;
$$;
update public.vendor_links l set order_id = x.order_id
  from (select distinct on (fl.vendor_id, b.storage_path) fl.vendor_id, b.storage_path, fl.order_id
          from public.freight_bill_lines fl join public.freight_bills b on b.id = fl.bill_id
         where fl.confirmed and fl.order_id is not null and b.storage_path is not null) x
 where l.kind = 'freight_bill' and l.vendor_id = x.vendor_id and l.storage_path = x.storage_path and l.order_id is null;
