-- 0046 — Delivery receipts (Dana, Oct 8): XPO emails a signed delivery receipt PDF for every LTL pallet
-- (deliveryreceipt@xpo.com). Claude reads it; the shipper is the vendor, the PO finds the order. The email
-- is filed to that vendor, the PDF goes into the vendor's (and order's) files, and the order gets its
-- received date when it had none. A receipt whose shipper Claude cannot match goes to the review queue
-- for the carrier's owner (Trevor). Receipts are not bills: nothing goes to "To pay".

-- XPO: LTL carrier, its mail is freight mail for Trevor.
insert into public.carriers (organization_id, name, mode, email_domains, website, owner_id, notes)
select o.id, 'XPO', 'ltl', array['xpo.com'], 'https://www.xpo.com',
       (select p.id from public.profiles p where p.organization_id = o.id and p.is_active and lower(p.email) like 'trevor@%' limit 1),
       'LTL. Emails a delivery receipt PDF for each delivery (deliveryreceipt@xpo.com); VMS files it to the shipper''s vendor.'
  from public.organizations o
 where exists (select 1 from public.mail_accounts m where m.organization_id = o.id)
on conflict (organization_id, name) do nothing;

do $$
declare
  s record;
  r record;
begin
  for s in select es.*, public.mail_carrier_for(es.organization_id, es.sender_key) as cid from public.email_senders es where es.kind = 'unknown' loop
    continue when s.cid is null;
    update public.email_senders set kind = 'carrier', carrier_id = s.cid, decided_at = now() where id = s.id;
    update public.review_items set status = 'accepted', resolved_at = now(), resolution_note = 'Freight carrier'
     where id = s.review_item_id and status = 'pending';
  end loop;
  for r in select distinct e.thread_id from public.emails e join public.email_senders es on es.id = e.sender_id where es.kind = 'carrier' loop
    perform public.mail_mark_carrier_thread(r.thread_id);
  end loop;
end $$;

alter table public.vendor_links drop constraint if exists vendor_links_kind_check;
alter table public.vendor_links add constraint vendor_links_kind_check check (kind in ('catalog', 'price_list', 'order_form', 'specials', 'website', 'other', 'invoice', 'confirmation', 'order', 'packing_slip', 'payment', 'freight_bill', 'delivery_receipt'));
alter table public.emails drop constraint if exists emails_match_how_check;
alter table public.emails add constraint emails_match_how_check check (match_how in ('thread', 'sender', 'domain', 'directory', 'rep_group', 'platform', 'manual', 'receipt'));

create table if not exists public.delivery_receipts (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete restrict,
  carrier_id         uuid references public.carriers(id) on delete set null,
  email_id           uuid not null unique references public.emails(id) on delete cascade,
  pro_number         text,
  shipper_name       text,
  po_numbers         text[] not null default '{}',
  delivered_on       date,
  signed_by          text,
  pieces             integer,
  weight_lb          numeric(10,1),
  vendor_candidates  uuid[] not null default '{}',
  vendor_id          uuid references public.vendors(id) on delete set null,
  order_id           uuid references public.orders(id) on delete set null,
  vendor_link_id     uuid references public.vendor_links(id) on delete set null,
  storage_path       text,
  file_name          text,
  status             text not null default 'reading' check (status in ('reading', 'filed', 'needs_vendor', 'failed')),
  read_note          text,
  review_item_id     uuid references public.review_items(id) on delete set null,
  created_at         timestamptz not null default now()
);
create index if not exists delivery_receipts_vendor_idx on public.delivery_receipts (vendor_id);
create index if not exists delivery_receipts_order_idx on public.delivery_receipts (order_id);
comment on table public.delivery_receipts is 'Carrier delivery receipts read by Claude: shipper (vendor), PO (order), delivered date, signed by.';

alter table public.delivery_receipts enable row level security;
drop policy if exists "delivery_receipts: members read" on public.delivery_receipts;
create policy "delivery_receipts: members read" on public.delivery_receipts for select to authenticated using (public.user_in_org(organization_id));
grant select on table public.delivery_receipts to authenticated;
grant all on table public.delivery_receipts to service_role;

-- "PO# 60851", "60851", "po 60851" all compare as 60851.
create or replace function public.po_key(p text)
returns text language sql immutable as $$
  select nullif(regexp_replace(regexp_replace(lower(coalesce(p, '')), '^\s*(p\.?\s?o\.?|purchase order)\s*(#|no\.?|number)?\s*', ''), '[^a-z0-9]', '', 'g'), '')
$$;
grant execute on function public.po_key(text) to authenticated, service_role;

-- File a read receipt to a vendor (and order): the email, the PDF in their files, the received date.
create or replace function public.delivery_receipt_file(p_receipt uuid, p_vendor uuid, p_order uuid default null)
returns void
language plpgsql security definer
set search_path = public
as $$
declare
  d        public.delivery_receipts%rowtype;
  e        public.emails%rowtype;
  v_order  uuid := p_order;
  v_link   uuid;
  v_label  text;
  v_note   text;
begin
  select * into d from public.delivery_receipts where id = p_receipt for update;
  if d.id is null then raise exception 'Delivery receipt not found' using errcode = '23503'; end if;
  if not exists (select 1 from public.vendors where id = p_vendor and organization_id = d.organization_id) then raise exception 'Vendor not found' using errcode = '23503'; end if;
  if v_order is not null and not exists (select 1 from public.orders where id = v_order and vendor_id = p_vendor) then raise exception 'That order is not this vendor''s' using errcode = '22023'; end if;
  if v_order is null and cardinality(d.po_numbers) > 0 then
    select (array_agg(o.id))[1] into v_order from public.orders o
     where o.vendor_id = p_vendor and public.po_key(o.po_number) = any (select public.po_key(x) from unnest(d.po_numbers) x)
    having count(*) = 1;
  end if;
  select * into e from public.emails where id = d.email_id;

  v_label := coalesce((select name from public.carriers where id = d.carrier_id), 'Carrier') || ' delivery receipt' || coalesce(' ' || d.pro_number, '');
  v_note := concat_ws(', ',
    case when d.delivered_on is not null then 'Delivered ' || to_char(d.delivered_on, 'Mon FMDD, YYYY') end,
    case when d.signed_by is not null then 'signed by ' || d.signed_by end,
    case when cardinality(d.po_numbers) > 0 then 'PO ' || array_to_string(d.po_numbers, ', ') end,
    case when d.shipper_name is not null then 'shipper ' || d.shipper_name end);

  if d.storage_path is not null then
    if d.vendor_link_id is not null and exists (select 1 from public.vendor_links where id = d.vendor_link_id) then
      update public.vendor_links set vendor_id = p_vendor, order_id = v_order where id = d.vendor_link_id;
      v_link := d.vendor_link_id;
    else
      insert into public.vendor_links (organization_id, vendor_id, order_id, kind, label, storage_path, file_name, mime_type, received_at, source, email_id, notes)
      values (d.organization_id, p_vendor, v_order, 'delivery_receipt', v_label, d.storage_path, d.file_name, 'application/pdf',
              coalesce(d.delivered_on, e.received_at::date), 'email', d.email_id, v_note)
      returning id into v_link;
    end if;
    update public.email_attachments set vendor_link_id = v_link where email_id = d.email_id and storage_path = d.storage_path;
  end if;

  update public.delivery_receipts set vendor_id = p_vendor, order_id = v_order, vendor_link_id = v_link, status = 'filed', read_note = null where id = p_receipt;

  -- The receipt is the best evidence for its own email; the rest of its thread only when unfiled.
  update public.emails set vendor_id = p_vendor, match_how = 'receipt', order_id = coalesce(v_order, order_id), files_scanned_at = coalesce(files_scanned_at, now())
   where id = d.email_id;
  update public.emails set vendor_id = p_vendor, match_how = 'receipt' where thread_id = e.thread_id and vendor_id is null;
  update public.email_threads set vendor_id = p_vendor where id = e.thread_id;
  perform public.mail_refresh_thread(e.thread_id, false);

  if v_order is not null and d.delivered_on is not null then
    update public.orders set date_received = d.delivered_on where id = v_order and date_received is null;
  end if;

  update public.review_items set status = 'accepted', resolved_by = auth.uid(), resolved_at = now(),
         resolution_note = 'Filed to ' || (select name from public.vendors where id = p_vendor)
   where id = d.review_item_id and status = 'pending';
end;
$$;
revoke execute on function public.delivery_receipt_file(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.delivery_receipt_file(uuid, uuid, uuid) to service_role;

-- After Claude read it (gmail-sync): one matching order by PO, else one matching vendor by shipper name;
-- otherwise the receipt asks the carrier's owner in the review queue.
create or replace function public.delivery_receipt_loaded(p_receipt uuid)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  d        public.delivery_receipts%rowtype;
  v_orders uuid[];
  v_vendor uuid;
  v_order  uuid;
  v_owner  uuid;
  v_item   uuid;
begin
  select * into d from public.delivery_receipts where id = p_receipt;
  if d.id is null then raise exception 'Delivery receipt not found' using errcode = '23503'; end if;
  if cardinality(d.po_numbers) > 0 then
    select array_agg(o.id) into v_orders from public.orders o
     where o.organization_id = d.organization_id
       and public.po_key(o.po_number) = any (select public.po_key(x) from unnest(d.po_numbers) x)
       and (cardinality(d.vendor_candidates) = 0 or o.vendor_id = any (d.vendor_candidates));
    if cardinality(v_orders) = 1 then
      v_order := v_orders[1];
      select vendor_id into v_vendor from public.orders where id = v_order;
    end if;
  end if;
  if v_vendor is null and cardinality(d.vendor_candidates) = 1 then v_vendor := d.vendor_candidates[1]; end if;

  if v_vendor is not null then
    perform public.delivery_receipt_file(p_receipt, v_vendor, v_order);
    return 'filed';
  end if;

  select owner_id into v_owner from public.carriers where id = d.carrier_id;
  insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details, assigned_to, assigned_at)
  values (d.organization_id, 'delivery_receipt', 'delivery_receipt', d.id,
          'Delivery receipt' || coalesce(' ' || d.pro_number, '') || ': which vendor shipped it?',
          jsonb_build_object('shipper_name', d.shipper_name, 'pro_number', d.pro_number, 'po_numbers', to_jsonb(d.po_numbers),
                             'delivered_on', d.delivered_on, 'email_id', d.email_id,
                             'thread_id', (select thread_id from public.emails where id = d.email_id),
                             'carrier', (select name from public.carriers where id = d.carrier_id),
                             'vendor_candidates', to_jsonb(d.vendor_candidates)),
          v_owner, case when v_owner is not null then now() end)
  returning id into v_item;
  update public.delivery_receipts set status = 'needs_vendor', review_item_id = v_item where id = p_receipt;
  return 'needs_vendor';
end;
$$;
revoke execute on function public.delivery_receipt_loaded(uuid) from public, anon, authenticated;
grant execute on function public.delivery_receipt_loaded(uuid) to service_role;

-- The review card's "File to this vendor".
create or replace function public.file_delivery_receipt(p_receipt uuid, p_vendor uuid)
returns void
language plpgsql security definer
set search_path = public
as $$
declare v_org uuid;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers file mail' using errcode = '42501'; end if;
  select organization_id into v_org from public.delivery_receipts where id = p_receipt;
  if v_org is null or not public.user_in_org(v_org) then raise exception 'Delivery receipt not found' using errcode = '23503'; end if;
  perform public.delivery_receipt_file(p_receipt, p_vendor, null);
end;
$$;
revoke execute on function public.file_delivery_receipt(uuid, uuid) from public, anon;
grant execute on function public.file_delivery_receipt(uuid, uuid) to authenticated, service_role;
