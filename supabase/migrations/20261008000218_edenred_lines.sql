-- 0218 — Edenred invoice lines (Dana, Oct 21: "We can populate all the lines of every order with this spreadsheet";
-- "go"). Edenred's line export (SequenceNo, DocumentType, PONumber, InvoiceNumber, MfgStockNo, ItemNumber,
-- LineDescription, Quantity, UnitPrice, UnitDiscount, LineAmount, FreightAmount, NDFreight, VendorActive, TrackingNo…):
--   • every WWD invoice keeps its lines (Vendor ID = MfgStockNo, UPC = ItemNumber, unit cost = UnitPrice − UnitDiscount);
--   • an order with no items gets them from its WWD invoices ("from the WWD invoice": what was billed);
--   • freight: Edenred's freight is kept on the invoice; an order with none gets it; a different amount, or freight on an
--     order marked ships free, becomes a "Freight differs" card ("list the amount from Edenred if it differs … flag");
--   • PO: each invoice's PO is ours, ours written differently, their own number, or none (Dana: "Some vendors totally
--     ignore your PO … I want to know who does that"); an invoice tied to an order with another PO is a card;
--     an untied invoice is tied by PO when exactly one of the vendor's orders has it;
--   • Vendor Active (A/I) goes on the vendor as WWD Active, as of the export; ND Freight Y/N is kept on the invoice;
--   • a credit memo shows on the invoice it is for (same PO, else a card asks which) — "so we don't have to look two
--     places".
-- Shared freight (Dana, Oct 21): a carrier's bill through WWD (XPO) is one bill for several vendors' orders on a pallet;
-- Trevor adds the orders (search by PO, Vendor Inv #, WWD Seq # or vendor, or from the order he checks in) and the
-- freight is shared by merchandise cost (the same freight % for every vendor), any amount editable, adding up to the bill.
-- XPO bills from before June 2026 are left alone ("ignore the XPO bills that came in before Trevor started").

-- ---- invoices, vendors, order items ---------------------------------------------------------------------------------
alter table public.wwd_invoices add column if not exists nd_freight boolean;
alter table public.wwd_invoices add column if not exists tracking_no text;
alter table public.wwd_invoices add column if not exists edenred_freight numeric(12,2);
alter table public.wwd_invoices add column if not exists misc_amount numeric(12,2);
alter table public.wwd_invoices add column if not exists po_result text check (po_result in ('ours', 'ours_written_differently', 'theirs', 'none'));
alter table public.wwd_invoices add column if not exists credit_for_id uuid references public.wwd_invoices(id) on delete set null;
alter table public.wwd_invoices add column if not exists lines_loaded_at timestamptz;
comment on column public.wwd_invoices.nd_freight is 'Edenred''s ND Freight (Y/N), kept as is.';
comment on column public.wwd_invoices.edenred_freight is 'The freight Edenred shows on this invoice (header, else its freight lines).';
comment on column public.wwd_invoices.po_result is 'The PO on the invoice: ours, ours written differently, the vendor''s own number, or none.';
comment on column public.wwd_invoices.credit_for_id is 'A credit memo: the WWD invoice it is for.';

alter table public.vendors add column if not exists wwd_active boolean;
alter table public.vendors add column if not exists wwd_active_as_of date;
comment on column public.vendors.wwd_active is 'Edenred''s Vendor Active: still with WWD (A) or not (I), as of wwd_active_as_of.';

alter table public.order_lines add column if not exists upc text;
alter table public.order_lines add column if not exists wwd_invoice_id uuid references public.wwd_invoices(id) on delete set null;
comment on column public.order_lines.wwd_invoice_id is 'Added from this WWD invoice''s lines (what was billed).';

create table if not exists public.wwd_invoice_lines (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id      uuid not null references public.wwd_invoices(id) on delete cascade,
  line_no         integer not null,
  vendor_item_id  text,
  upc             text,
  description     text,
  quantity        numeric,
  unit_price      numeric(12,4),
  unit_discount   numeric(12,4),
  amount          numeric(12,2),
  is_freight      boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (invoice_id, line_no)
);
comment on table public.wwd_invoice_lines is 'The lines of a WWD invoice or credit, from Edenred''s line export (Oct 21).';
alter table public.wwd_invoice_lines enable row level security;
drop policy if exists "wwd_invoice_lines: members read" on public.wwd_invoice_lines;
create policy "wwd_invoice_lines: members read" on public.wwd_invoice_lines for select to authenticated using (public.user_in_org(organization_id));
grant select on table public.wwd_invoice_lines to authenticated;
grant all on table public.wwd_invoice_lines to service_role;

/** A PO as letters and digits only, for comparing. */
create or replace function public.po_loose(p text) returns text language sql immutable as $$
  select nullif(regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]', '', 'g'), '')
$$;

/** The invoice's PO is the order's PO, as typed or written differently (HADDAD8127 / HADDAD8/27/25). */
create or replace function public.wwd_po_matches(p_po text, p_order_po text) returns boolean
language sql immutable as $$
  select public.po_loose(p_po) is not null and public.po_loose(p_order_po) is not null and (
    public.po_loose(p_po) = public.po_loose(p_order_po)
    or strpos(public.po_loose(p_po), public.po_loose(p_order_po)) > 0 or strpos(public.po_loose(p_order_po), public.po_loose(p_po)) > 0
    or (length(regexp_replace(public.po_loose(p_po), '[0-9]', '', 'g')) >= 2
        and regexp_replace(public.po_loose(p_po), '[0-9]', '', 'g') = regexp_replace(public.po_loose(p_order_po), '[0-9]', '', 'g')
        and regexp_replace(public.po_loose(p_po), '[^0-9]', '', 'g') <> ''))
$$;

/**
 * What the PO on a WWD invoice is: ours (the order's PO, or one in our naming: abbreviation + date), ours written
 * differently (the order's PO written another way, or the vendor's letters with a date cut short: BRIGHTSTRIPES212),
 * the vendor's own number, or none.
 */
create or replace function public.wwd_po_result(p_po text, p_order_po text, p_code text, p_vendor text) returns text
language sql immutable as $$
  with x as (
    select public.po_loose(p_po) as po, public.po_loose(p_order_po) as op,
           substring(public.po_loose(p_po) from '^([A-Z]{3,})[0-9]') as letters,
           public.po_loose(p_code) as code, public.po_loose(p_vendor) as vname)
  select case
    when x.po is null or not public.is_real_po(p_po) then 'none'
    when x.po = x.op then 'ours'
    when public.wwd_po_matches(p_po, p_order_po) then 'ours_written_differently'
    when x.po ~ (case when x.code is not null then '^' || x.code || '[0-9]{4,6}' else '^[A-Z]{2,}[0-9]{4,6}' end) then 'ours'
    when x.letters is not null and ((x.code is not null and (left(x.code, length(x.letters)) = x.letters or left(x.letters, length(x.code)) = x.code))
                                    or (x.vname is not null and left(x.vname, length(x.letters)) = x.letters)) then 'ours_written_differently'
    else 'theirs' end
  from x
$$;

-- ---- the import ------------------------------------------------------------------------------------------------------
/**
 * Edenred's line export, after its invoices went through wwd_import: { as_of, invoices: [{ seq, nd_freight, vendor_active,
 * tracking, misc, freight, lines: [{ vid, upc, desc, qty, price, unit_discount, amount }] }] }. Runs again safely:
 * lines are replaced, blanks filled, cards made once. Returns counts.
 */
create or replace function public.wwd_edenred_lines(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org    uuid := coalesce(public.current_user_org(), nullif(p->>'organization_id', '')::uuid);
  v_asof   date := coalesce(nullif(p->>'as_of', '')::date, current_date);
  r        jsonb;
  l        jsonb;
  w        public.wwd_invoices%rowtype;
  o        public.orders%rowtype;
  v_n      integer;
  v_free   numeric;
  v_res    text;
  v_cand   uuid;
  v_cnt    integer;
  v_orders uuid[] := '{}';
  v_oid    uuid;
  v_sum    numeric;
  n_inv integer := 0; n_lines integer := 0; n_missing integer := 0; n_tied integer := 0; n_po_cards integer := 0;
  n_credit integer := 0; n_credit_cards integer := 0; n_items integer := 0; n_freight_set integer := 0; n_freight_cards integer := 0;
  n_vendor integer := 0;
begin
  if auth.uid() is not null and not public.user_can_edit() then raise exception 'Only admins, managers and buyers import WWD files' using errcode = '42501'; end if;
  if v_org is null then raise exception 'Which organization?' using errcode = '22023'; end if;

  for r in select * from jsonb_array_elements(coalesce(p->'invoices', '[]')) loop
    select * into w from public.wwd_invoices
     where organization_id = v_org and ltrim(seq, '0') = ltrim(regexp_replace(coalesce(r->>'seq', ''), '[^0-9]', '', 'g'), '0')
     order by (kind = 'credit') = coalesce((r->>'credit')::boolean, false) desc, created_at limit 1;
    if w.id is null then n_missing := n_missing + 1; continue; end if;
    n_inv := n_inv + 1;

    -- the lines, replaced
    delete from public.wwd_invoice_lines where invoice_id = w.id;
    v_n := 0;
    for l in select * from jsonb_array_elements(coalesce(r->'lines', '[]')) loop
      v_n := v_n + 1;
      insert into public.wwd_invoice_lines (organization_id, invoice_id, line_no, vendor_item_id, upc, description, quantity, unit_price, unit_discount, amount, is_freight)
      values (v_org, w.id, v_n, nullif(trim(l->>'vid'), ''), nullif(trim(l->>'upc'), ''), nullif(trim(l->>'desc'), ''),
              nullif(l->>'qty', '')::numeric, nullif(l->>'price', '')::numeric, nullif(l->>'unit_discount', '')::numeric, nullif(l->>'amount', '')::numeric,
              coalesce(l->>'desc', '') ~* '(freight|shipping)' and nullif(trim(l->>'vid'), '') is null and nullif(trim(l->>'upc'), '') is null);
    end loop;
    n_lines := n_lines + v_n;
    v_free := coalesce(nullif(nullif(r->>'freight', ''), '0')::numeric,
                       (select sum(amount) from public.wwd_invoice_lines where invoice_id = w.id and is_freight), 0);
    update public.wwd_invoices set
      nd_freight = case upper(coalesce(r->>'nd_freight', '')) when 'Y' then true when 'N' then false else nd_freight end,
      tracking_no = coalesce(tracking_no, nullif(trim(r->>'tracking'), '')),
      misc_amount = coalesce(misc_amount, nullif(nullif(r->>'misc', ''), '0')::numeric),
      edenred_freight = v_free, lines_loaded_at = now()
     where id = w.id;

    -- the vendor: still with WWD?
    if w.vendor_id is not null and upper(coalesce(r->>'vendor_active', '')) in ('A', 'I') then
      update public.vendors set wwd_active = upper(r->>'vendor_active') = 'A', wwd_active_as_of = v_asof
       where id = w.vendor_id and (wwd_active_as_of is null or wwd_active_as_of <= v_asof)
         and (wwd_active is distinct from (upper(r->>'vendor_active') = 'A') or wwd_active_as_of is distinct from v_asof);
      if found then n_vendor := n_vendor + 1; end if;
    end if;

    -- an untied invoice: the vendor's one order with this PO
    if w.order_id is null and w.vendor_id is not null and public.is_real_po(w.po_number) then
      select min(id::text)::uuid, count(*) into v_cand, v_cnt from public.orders
       where vendor_id = w.vendor_id and status <> 'cancelled' and public.po_loose(po_number) = public.po_loose(w.po_number);
      if v_cnt = 1 then
        update public.wwd_invoices set order_id = v_cand, order_set_by = 'auto' where id = w.id;
        w.order_id := v_cand;
        n_tied := n_tied + 1;
      end if;
    end if;

    -- the PO
    select * into o from public.orders where id = w.order_id;
    v_res := public.wwd_po_result(w.po_number, o.po_number, (select po_code from public.vendors where id = w.vendor_id), (select name from public.vendors where id = w.vendor_id));
    update public.wwd_invoices set po_result = v_res where id = w.id;
    if o.id is not null and w.kind <> 'credit' and public.po_loose(w.po_number) is not null and public.po_loose(o.po_number) is not null and not public.wwd_po_matches(w.po_number, o.po_number)
       and not exists (select 1 from public.review_items where kind = 'wwd_po_mismatch' and entity_id = w.id) then
      insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
      values (v_org, 'wwd_po_mismatch', 'wwd_invoice', w.id,
              left(coalesce((select name from public.vendors where id = w.vendor_id), w.wwd_vendor_name, 'WWD invoice') || ': PO ' || w.po_number || ' on WWD Seq # ' || w.seq || ', order PO ' || o.po_number, 200),
              jsonb_build_object('invoice_po', w.po_number, 'order_po', o.po_number, 'order_id', o.id, 'seq', w.seq, 'vendor_id', w.vendor_id));
      n_po_cards := n_po_cards + 1;
    end if;

    if w.order_id is not null and w.kind = 'invoice' then v_orders := array_append(v_orders, w.order_id); end if;
  end loop;

  -- credits: the invoice they are for (same vendor and PO, before the credit), else a card
  for w in select * from public.wwd_invoices i where i.organization_id = v_org and i.kind = 'credit' and i.credit_for_id is null and i.lines_loaded_at is not null loop
    select min(id::text)::uuid, count(*) into v_cand, v_cnt from public.wwd_invoices x
     where x.organization_id = v_org and x.kind = 'invoice' and x.vendor_id = w.vendor_id and w.vendor_id is not null
       and public.po_loose(w.po_number) is not null and public.po_loose(x.po_number) = public.po_loose(w.po_number)
       and coalesce(x.wwd_date, x.vendor_invoice_date) <= coalesce(w.wwd_date, w.vendor_invoice_date, current_date);
    if v_cnt = 1 then
      update public.wwd_invoices set credit_for_id = v_cand where id = w.id;
      n_credit := n_credit + 1;
    elsif not exists (select 1 from public.review_items where kind = 'wwd_credit_for' and entity_id = w.id) then
      insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
      values (v_org, 'wwd_credit_for', 'wwd_invoice', w.id,
              left('WWD credit ' || to_char(abs(w.amount), 'FM$999,999,990.00') || ' from ' || coalesce((select name from public.vendors where id = w.vendor_id), w.wwd_vendor_name, 'a vendor')
                   || ' (WWD Seq # ' || w.seq || '): which invoice is it for?', 200),
              jsonb_build_object('seq', w.seq, 'vendor_id', w.vendor_id, 'amount', w.amount, 'po_number', w.po_number,
                                 'vendor_invoice_number', w.vendor_invoice_number, 'lines', (select jsonb_agg(description order by line_no) from public.wwd_invoice_lines where invoice_id = w.id)));
      n_credit_cards := n_credit_cards + 1;
    end if;
  end loop;

  -- orders: items from their invoices when they have none; freight from Edenred, or a card when it differs
  foreach v_oid in array coalesce((select array_agg(distinct x) from unnest(v_orders) x), '{}'::uuid[]) loop
    select * into o from public.orders where id = v_oid;
    if not exists (select 1 from public.order_lines where order_id = v_oid) then
      insert into public.order_lines (organization_id, order_id, sort_order, vendor_item_id, upc, description, quantity, unit_cost, wwd_invoice_id, notes)
      select o.organization_id, v_oid, row_number() over (order by i.wwd_date, i.seq, l.line_no), coalesce(l.vendor_item_id, l.upc), l.upc, l.description, l.quantity,
             round(coalesce(l.unit_price, 0) - coalesce(l.unit_discount, 0), 4), i.id, 'From WWD invoice ' || i.seq
        from public.wwd_invoices i join public.wwd_invoice_lines l on l.invoice_id = i.id
       where i.order_id = v_oid and i.kind = 'invoice' and not l.is_freight and l.quantity is not null and l.quantity <> 0;
      get diagnostics v_cnt = row_count;
      if v_cnt > 0 then n_items := n_items + 1; end if;
    end if;
    -- freight from a shared (pallet) bill is Trevor's, not compared
    if exists (select 1 from public.freight_bill_lines fl where fl.order_id = v_oid and fl.confirmed) then continue; end if;
    select coalesce(sum(edenred_freight), 0) into v_sum from public.wwd_invoices where order_id = v_oid and kind = 'invoice' and lines_loaded_at is not null;
    if o.freight_cost is null and v_sum > 0 then
      update public.orders set freight_cost = v_sum, freight_notes = coalesce(freight_notes, 'From the WWD invoice (Edenred)') where id = v_oid;
      n_freight_set := n_freight_set + 1;
    elsif (o.freight_cost is not null and abs(o.freight_cost - v_sum) > 0.01) or (o.free_shipping is true and v_sum > 0) then
      if not exists (select 1 from public.review_items where kind = 'wwd_freight_differs' and entity_id = v_oid and status = 'pending') then
        insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
        values (o.organization_id, 'wwd_freight_differs', 'order', v_oid,
                left(coalesce((select name from public.vendors where id = o.vendor_id), 'Order') || coalesce(' PO ' || o.po_number, '') || ': freight '
                     || case when o.free_shipping is true and v_sum > 0 and o.freight_cost is null then 'charged on an order that ships free'
                             else coalesce(to_char(o.freight_cost, 'FM$999,999,990.00'), 'none') || ' in VMS, ' || to_char(v_sum, 'FM$999,999,990.00') || ' in Edenred' end, 200),
                jsonb_build_object('order_id', v_oid, 'vms', o.freight_cost, 'edenred', v_sum, 'free_shipping', o.free_shipping));
        n_freight_cards := n_freight_cards + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('invoices', n_inv, 'lines', n_lines, 'not_in_vms', n_missing, 'tied_by_po', n_tied, 'po_cards', n_po_cards,
    'credits_linked', n_credit, 'credit_cards', n_credit_cards, 'orders_given_items', n_items, 'freight_filled', n_freight_set,
    'freight_cards', n_freight_cards, 'vendors_wwd_status', n_vendor,
    'shared_bills', public.freight_shared_from_wwd(v_org));
end;
$$;
revoke execute on function public.wwd_edenred_lines(jsonb) from public, anon;
grant execute on function public.wwd_edenred_lines(jsonb) to authenticated, service_role;

/** The three Edenred cards. */
create or replace function public.wwd_review_answer(p_item uuid, p_action text, p_target uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare it public.review_items%rowtype; d jsonb;
begin
  select * into it from public.review_items where id = p_item;
  if it.id is null or not public.user_in_org(it.organization_id) or not public.user_can_edit() then raise exception 'Not found' using errcode = '23503'; end if;
  d := it.details;
  if it.kind = 'wwd_freight_differs' then
    if p_action = 'use_edenred' then
      update public.orders set freight_cost = (d->>'edenred')::numeric, freight_notes = 'From the WWD invoice (Edenred)' where id = it.entity_id;
    elsif p_action <> 'keep' then raise exception 'Use Edenred''s or keep ours' using errcode = '22023'; end if;
  elsif it.kind = 'wwd_po_mismatch' then
    if p_action = 'untie' then
      update public.wwd_invoices set order_id = null, order_set_by = 'person' where id = it.entity_id;
    elsif p_action = 'move' then
      if p_target is null or not exists (select 1 from public.orders o join public.wwd_invoices w on w.id = it.entity_id where o.id = p_target and o.organization_id = w.organization_id) then
        raise exception 'Pick the order' using errcode = '22023';
      end if;
      update public.wwd_invoices set order_id = p_target, order_set_by = 'person' where id = it.entity_id;
    elsif p_action <> 'keep' then raise exception 'Keep, move or untie' using errcode = '22023'; end if;
  elsif it.kind = 'wwd_credit_for' then
    if p_action = 'pick' then
      if p_target is null or not exists (select 1 from public.wwd_invoices x join public.wwd_invoices c on c.id = it.entity_id where x.id = p_target and x.organization_id = c.organization_id and x.kind = 'invoice') then
        raise exception 'Pick the invoice' using errcode = '22023';
      end if;
      update public.wwd_invoices set credit_for_id = p_target where id = it.entity_id;
    elsif p_action <> 'none' then raise exception 'Pick the invoice, or none' using errcode = '22023'; end if;
  else
    raise exception 'Not an Edenred card' using errcode = '22023';
  end if;
  update public.review_items set status = (case when p_action in ('keep', 'none') then 'rejected' else 'accepted' end)::public.review_status,
         resolved_at = now(), resolved_by = auth.uid(), resolution_note = p_action where id = p_item;
end;
$$;
revoke execute on function public.wwd_review_answer(uuid, text, uuid) from public, anon;
grant execute on function public.wwd_review_answer(uuid, text, uuid) to authenticated;

/** A vendor's use of our PO on its WWD invoices (Dana, Oct 21). */
create or replace function public.vendor_po_use(p_vendor uuid)
returns table (invoices integer, ours integer, written_differently integer, theirs integer, no_po integer)
language sql stable security definer set search_path = public as $$
  select count(*)::int, count(*) filter (where po_result = 'ours')::int, count(*) filter (where po_result = 'ours_written_differently')::int,
         count(*) filter (where po_result = 'theirs')::int, count(*) filter (where po_result = 'none')::int
    from public.wwd_invoices
   where vendor_id = p_vendor and kind = 'invoice' and po_result is not null and public.user_in_org(organization_id)
$$;
revoke execute on function public.vendor_po_use(uuid) from public, anon;
grant execute on function public.vendor_po_use(uuid) to authenticated;

/** Every vendor's use of our PO, the worst first (Reports). */
create or replace function public.vendors_po_use(p_org uuid)
returns table (vendor_id uuid, vendor_name text, invoices integer, ours integer, written_differently integer, theirs integer, no_po integer, examples text[])
language sql stable security definer set search_path = public as $$
  select v.id, v.name, count(*)::int, count(*) filter (where w.po_result = 'ours')::int, count(*) filter (where w.po_result = 'ours_written_differently')::int,
         count(*) filter (where w.po_result = 'theirs')::int, count(*) filter (where w.po_result = 'none')::int,
         (array_agg(coalesce(w.po_number, '(none)') order by w.wwd_date desc) filter (where w.po_result in ('theirs', 'none')))[1:3]
    from public.wwd_invoices w join public.vendors v on v.id = w.vendor_id
   where w.organization_id = p_org and public.user_in_org(p_org) and w.kind = 'invoice' and w.po_result is not null
   group by v.id, v.name
  having count(*) filter (where w.po_result in ('theirs', 'none')) > 0
   order by count(*) filter (where w.po_result in ('theirs', 'none'))::numeric / count(*) desc, count(*) desc, v.name
$$;
revoke execute on function public.vendors_po_use(uuid) from public, anon;
grant execute on function public.vendors_po_use(uuid) to authenticated;

-- ---- shared freight (pallet) bills -----------------------------------------------------------------------------------
alter table public.freight_bills add column if not exists shared boolean not null default false;
alter table public.freight_bills add column if not exists wwd_invoice_id uuid references public.wwd_invoices(id) on delete set null;
alter table public.freight_bill_lines add column if not exists manual_amount boolean not null default false;
comment on column public.freight_bills.shared is 'One shipment for several vendors'' orders (a WWD pallet): Trevor shares it out (Dana, Oct 21).';
create unique index if not exists freight_bills_wwd_invoice on public.freight_bills (wwd_invoice_id) where wwd_invoice_id is not null;

/**
 * A freight company's bill through WWD (XPO) becomes a shared freight bill with a task for the logistics person. Bills
 * dated before June 2026 are left alone (before Trevor). Returns how many were made.
 */
create or replace function public.freight_shared_from_wwd(p_org uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare w record; v_bill uuid; v_who uuid; v_due date; n integer := 0;
begin
  for w in select i.*, c.name as carrier_name from public.wwd_invoices i join public.carriers c on c.id = i.carrier_id
            where i.organization_id = p_org and i.kind = 'invoice' and i.amount > 0
              and coalesce(i.vendor_invoice_date, i.wwd_date) >= date '2026-06-01'
              and not exists (select 1 from public.freight_bills b where b.wwd_invoice_id = i.id) loop
    insert into public.freight_bills (organization_id, carrier_id, invoice_number, invoice_date, total, status, shared, wwd_invoice_id, read_note)
    values (p_org, w.carrier_id, coalesce(w.vendor_invoice_number, 'WWD ' || w.seq), coalesce(w.vendor_invoice_date, w.wwd_date), w.amount, 'to_match', true, w.id,
            'Through WWD (WWD Seq # ' || w.seq || '): one shipment for several vendors'' orders. Add the orders that came on it.')
    returning id into v_bill;
    n := n + 1;
    -- the task for bills from now on (the June and August ones Trevor is breaking down for Dana)
    if coalesce(w.vendor_invoice_date, w.wwd_date) > date '2026-08-31' then
      v_who := coalesce(public.logistics_person(p_org), public.org_admin(p_org));
      v_due := public.next_business_day(now());
      insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, carrier_id, auto_key)
      values (p_org, left('Share ' || w.carrier_name || ' freight ' || to_char(w.amount, 'FM$999,999,990.00') || ' (' || to_char(coalesce(w.vendor_invoice_date, w.wwd_date), 'Mon FMDD, YYYY') || ') across the orders on it', 200),
              'One shipment for several vendors (a WWD pallet). Add each order that came on it; the freight is shared by merchandise cost.',
              v_due, (v_due + time '09:00') at time zone 'America/Los_Angeles', v_who, w.carrier_id, 'freight_share:' || v_bill)
      on conflict (organization_id, auto_key) where auto_key is not null do nothing;
    end if;
  end loop;
  return n;
end;
$$;
revoke execute on function public.freight_shared_from_wwd(uuid) from public, anon, authenticated;
grant execute on function public.freight_shared_from_wwd(uuid) to service_role;

/** An order's merchandise cost, for sharing freight: its final cost, else the estimate, else its items. */
create or replace function public.order_merch_cost(p_order uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(o.final_cost, o.est_cost, o.cost_basis, (select sum(extended) from public.order_lines l where l.order_id = o.id), 0)
    from public.orders o where o.id = p_order
$$;

/**
 * The orders on a shared freight bill: [{ order_id, amount }] (amount null = shared by merchandise cost). Amounts typed
 * stay; the rest of the bill is shared by merchandise cost (evenly when no cost is known). Everything must add up to the
 * bill. Each order's freight cost becomes its share; an order taken off goes back to no freight.
 */
create or replace function public.freight_share_set(p_bill uuid, p_orders jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare
  b        public.freight_bills%rowtype;
  r        jsonb;
  v_fixed  numeric := 0;
  v_rest   numeric;
  v_merch  numeric;
  v_count  integer;
  v_left   numeric;
  v_old    uuid[];
  v_new    uuid[] := '{}';
  v_id     uuid;
  v_amt    numeric;
  v_i      integer := 0;
  v_last   uuid;
begin
  select * into b from public.freight_bills where id = p_bill for update;
  if b.id is null or not public.user_in_org(b.organization_id) or not public.user_can_edit() then raise exception 'Freight bill not found' using errcode = '23503'; end if;
  if not b.shared then raise exception 'This bill is not shared across orders' using errcode = '22023'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_orders, '[]')) loop
    v_id := (r->>'order_id')::uuid;
    if not exists (select 1 from public.orders where id = v_id and organization_id = b.organization_id) then raise exception 'Order not found' using errcode = '23503'; end if;
    if v_id = any (v_new) then raise exception 'An order is on the list twice' using errcode = '22023'; end if;
    v_new := array_append(v_new, v_id);
    v_fixed := v_fixed + coalesce(nullif(r->>'amount', '')::numeric, 0);
  end loop;
  v_rest := b.total - v_fixed;
  select count(*), coalesce(sum(public.order_merch_cost((x->>'order_id')::uuid)), 0) into v_count, v_merch
    from jsonb_array_elements(coalesce(p_orders, '[]')) x where nullif(x->>'amount', '') is null;
  if v_count = 0 and cardinality(v_new) > 0 and abs(v_rest) > 0.005 then
    raise exception 'The amounts add up to % but the bill is %', to_char(v_fixed, 'FM$999,999,990.00'), to_char(b.total, 'FM$999,999,990.00') using errcode = '22023';
  end if;
  if v_count > 0 and v_rest < -0.005 then
    raise exception 'The amounts typed (%) are more than the bill (%)', to_char(v_fixed, 'FM$999,999,990.00'), to_char(b.total, 'FM$999,999,990.00') using errcode = '22023';
  end if;

  select array_agg(distinct order_id) into v_old from public.freight_bill_lines where bill_id = p_bill and order_id is not null;
  delete from public.freight_bill_lines where bill_id = p_bill;
  v_left := v_rest;
  for r in select * from jsonb_array_elements(coalesce(p_orders, '[]')) loop
    v_i := v_i + 1;
    v_id := (r->>'order_id')::uuid;
    if nullif(r->>'amount', '') is not null then
      v_amt := (r->>'amount')::numeric;
    else
      v_amt := round(case when v_merch > 0 then v_rest * public.order_merch_cost(v_id) / v_merch else v_rest / v_count end, 2);
      v_left := v_left - v_amt;
      v_last := v_id;
    end if;
    insert into public.freight_bill_lines (organization_id, bill_id, shipper_name, description, amount, fee_amount, vendor_id, order_id, confirmed, confirmed_by, confirmed_at, sort_order, manual_amount)
    select b.organization_id, p_bill, v.name, 'Share of the shipment', v_amt, 0, o.vendor_id, o.id, true, auth.uid(), now(), v_i, nullif(r->>'amount', '') is not null
      from public.orders o left join public.vendors v on v.id = o.vendor_id where o.id = v_id;
  end loop;
  -- the cents left by rounding go on the last shared order
  if v_last is not null and abs(v_left) >= 0.005 then
    update public.freight_bill_lines set amount = amount + round(v_left, 2) where bill_id = p_bill and order_id = v_last;
  end if;
  update public.freight_bills set status = case when cardinality(v_new) > 0 then 'done' else 'to_match' end where id = p_bill;
  -- each order's freight is its share; one taken off goes back to its other freight lines, else none
  for v_id in select distinct x from unnest(coalesce(v_old, '{}') || v_new) x loop
    if exists (select 1 from public.freight_bill_lines where order_id = v_id and confirmed) then
      perform public.freight_order_cost(v_id);
      update public.orders set freight_notes = 'Shared freight: ' || coalesce(b.invoice_number, 'freight bill') where id = v_id and (freight_notes is null or freight_notes like 'Shared freight:%' or freight_notes = 'From the WWD invoice (Edenred)');
    else
      update public.orders set freight_cost = null, freight_notes = null where id = v_id and freight_notes like 'Shared freight:%';
    end if;
  end loop;
  update public.tasks set done_at = now(), done_by = auth.uid(), done_note = 'Shared across ' || cardinality(v_new) || ' orders'
   where auto_key = 'freight_share:' || p_bill and done_at is null and cardinality(v_new) > 0;
end;
$$;
revoke execute on function public.freight_share_set(uuid, jsonb) from public, anon;
grant execute on function public.freight_share_set(uuid, jsonb) to authenticated;

/** Orders to add to a shared freight bill: by PO, Vendor Inv #, WWD Seq # or vendor name. */
create or replace function public.freight_share_search(p_org uuid, p_q text)
returns table (order_id uuid, vendor_name text, po_number text, order_date date, merch_cost numeric, seqs text[], vendor_invoices text[])
language sql stable security definer set search_path = public as $$
  with q as (select nullif(trim(coalesce(p_q, '')), '') as t)
  select o.id, v.name, o.po_number, o.order_date, public.order_merch_cost(o.id),
         (select array_agg(w.seq order by w.seq) from public.wwd_invoices w where w.order_id = o.id),
         (select array_agg(w.vendor_invoice_number order by w.seq) filter (where w.vendor_invoice_number is not null) from public.wwd_invoices w where w.order_id = o.id)
    from public.orders o join public.vendors v on v.id = o.vendor_id, q
   where o.organization_id = p_org and public.user_in_org(p_org) and q.t is not null and length(q.t) >= 2 and o.status <> 'cancelled'
     and (v.name ilike '%' || q.t || '%' or public.po_loose(o.po_number) like '%' || public.po_loose(q.t) || '%'
          or exists (select 1 from public.wwd_invoices w where w.order_id = o.id
                      and (ltrim(w.seq, '0') = ltrim(regexp_replace(q.t, '[^0-9]', '', 'g'), '0') or public.po_loose(w.vendor_invoice_number) = public.po_loose(q.t))))
   order by o.order_date desc nulls last
   limit 40
$$;
revoke execute on function public.freight_share_search(uuid, text) from public, anon;
grant execute on function public.freight_share_search(uuid, text) to authenticated;
