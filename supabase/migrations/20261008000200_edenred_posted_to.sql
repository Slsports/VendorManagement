-- 0200 — "Posted to Edenred" (Dana, Oct 19: "Posted Date … we need"): the day WWD posted the invoice to Edenred, kept
-- on each WWD invoice. The Edenred export's Posted Date column fills it on import; an Edenred PDF's Invoice Summary
-- fills it when blank. The first seven PDFs with a summary page (Oct 19) are filled from what their pages say.

alter table public.wwd_invoices add column if not exists posted_date date;
comment on column public.wwd_invoices.posted_date is 'Edenred Posted Date: when WWD posted the invoice to Edenred (not WWD''s invoice date).';

create or replace function public.wwd_upsert_invoice(v_org uuid, r jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_seq      text := ltrim(trim(r->>'seq'), '0');
  v_date_seq text;
  v_amt      numeric;
  v_kind     text;
  v_new      boolean;
begin
  if coalesce(v_seq, '') = '' then return false; end if;
  v_amt := nullif(r->>'amount', '')::numeric;
  v_kind := public.wwd_kind(v_seq, v_amt, r->>'kind', r->>'vendor_name');
  -- a scanned page can cut off the first digits ("363752" for 6863752): the one WWD number on file that
  -- ends with it and was paid that amount (less the discount) is the one
  if r->>'source' = 'scan' and not exists (select 1 from public.wwd_invoices where organization_id = v_org and seq = v_seq) then
    select (array_agg(distinct i.seq))[1] into v_date_seq from public.wwd_invoices i
      join public.wwd_payment_lines l on l.invoice_id = i.id
     where i.organization_id = v_org and i.seq like '%' || v_seq and length(v_seq) >= 5 and length(i.seq) > length(v_seq)
       and l.amount in (v_amt, v_amt - coalesce(nullif(r->>'discount', '')::numeric, 0))
    having count(distinct i.seq) = 1;
    v_seq := coalesce(v_date_seq, v_seq);
    v_date_seq := null;
  end if;
  insert into public.wwd_invoices as i (organization_id, seq, kind, wwd_date, wwd_vendor_name, po_number, vendor_invoice_number, vendor_invoice_date, amount, discount,
                                        due_date, terms, freight_amount, sheet_paid_date, posted_date, sources)
  values (v_org, v_seq, v_kind, nullif(r->>'wwd_date', '')::date, nullif(trim(r->>'vendor_name'), ''), nullif(trim(r->>'po_number'), ''), nullif(trim(r->>'vendor_invoice_number'), ''),
          nullif(r->>'vendor_invoice_date', '')::date, v_amt, nullif(r->>'discount', '')::numeric, nullif(r->>'due_date', '')::date, nullif(trim(r->>'terms'), ''),
          nullif(r->>'freight_amount', '')::numeric, nullif(r->>'sheet_paid_date', '')::date, nullif(r->>'posted_date', '')::date, array_remove(array[nullif(r->>'source', '')], null))
  on conflict (organization_id, seq, kind) do update set
    wwd_date = coalesce(excluded.wwd_date, i.wwd_date), wwd_vendor_name = coalesce(excluded.wwd_vendor_name, i.wwd_vendor_name),
    po_number = coalesce(excluded.po_number, i.po_number), vendor_invoice_number = coalesce(excluded.vendor_invoice_number, i.vendor_invoice_number),
    vendor_invoice_date = coalesce(excluded.vendor_invoice_date, i.vendor_invoice_date), amount = coalesce(excluded.amount, i.amount),
    discount = coalesce(nullif(excluded.discount, 0), i.discount, excluded.discount), due_date = coalesce(excluded.due_date, i.due_date), terms = coalesce(excluded.terms, i.terms),
    freight_amount = coalesce(excluded.freight_amount, i.freight_amount), sheet_paid_date = coalesce(i.sheet_paid_date, excluded.sheet_paid_date),
    posted_date = coalesce(excluded.posted_date, i.posted_date),
    sources = (select array_agg(distinct s) from unnest(i.sources || excluded.sources) s), updated_at = now()
  returning (xmax = 0) into v_new;
  return v_new;
end;
$$;
revoke execute on function public.wwd_upsert_invoice(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.wwd_upsert_invoice(uuid, jsonb) to service_role;

create or replace function public.wwd_edenred_place(p_org uuid, p jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_seq    text := nullif(ltrim(regexp_replace(coalesce(p->>'seq', ''), '[^0-9]', '', 'g'), '0'), '');
  v_vin    text := public.vin_norm(p->>'vendor_invoice_number');
  v_amt    numeric := abs(nullif(p->>'amount', '')::numeric);
  v_credit boolean := coalesce((p->>'credit')::boolean, false);
  v_ids    uuid[];
  v_added  boolean := false;
  v_one_v  boolean;
  v_one_o  boolean;
  v_vendor uuid;
  v_order  uuid;
  v_doc    uuid;
  v_num    text;
begin
  if v_seq is not null then
    select array_agg(id) into v_ids from (
      select id from public.wwd_invoices where organization_id = p_org and seq = v_seq
       order by (v_amt is not null and abs(amount) = v_amt) desc, (kind = case when v_credit then 'credit' else 'invoice' end) desc limit 1) x;
    if v_ids is null then
      perform public.wwd_upsert_invoice(p_org, jsonb_build_object(
        'seq', v_seq, 'kind', case when v_credit then 'credit' end, 'amount', case when v_credit then -v_amt else v_amt end,
        'vendor_name', p->>'vendor_name', 'vendor_invoice_number', p->>'vendor_invoice_number', 'vendor_invoice_date', nullif(p->>'invoice_date', ''), 'posted_date', nullif(p->>'posted_date', ''),
        'po_number', nullif(p->>'po_number', ''), 'source', 'edenred'));
      perform public.wwd_relink(p_org);
      select array_agg(id) into v_ids from public.wwd_invoices where organization_id = p_org and seq = v_seq;
      v_added := v_ids is not null;
    else
      -- only blanks are filled in
      update public.wwd_invoices set
        vendor_invoice_number = coalesce(vendor_invoice_number, nullif(trim(p->>'vendor_invoice_number'), '')),
        po_number = coalesce(po_number, nullif(trim(p->>'po_number'), '')),
        vendor_invoice_date = coalesce(vendor_invoice_date, nullif(p->>'invoice_date', '')::date),
        wwd_vendor_name = coalesce(wwd_vendor_name, nullif(trim(p->>'vendor_name'), '')),
        posted_date = coalesce(posted_date, nullif(p->>'posted_date', '')::date)
       where id = any (v_ids);
    end if;
  elsif v_vin is not null then
    -- no Worldwide number: the vendor's invoice number and amount (WWD sometimes bills one vendor invoice twice)
    select array_agg(id) into v_ids from public.wwd_invoices
     where organization_id = p_org and public.vin_norm(vendor_invoice_number) = v_vin and (v_amt is null or abs(amount) = v_amt);
  end if;
  if v_ids is null then return jsonb_build_object('placed', false); end if;

  select (array_agg(distinct vendor_id) filter (where vendor_id is not null))[1], count(distinct vendor_id) filter (where vendor_id is not null) = 1,
         (array_agg(distinct order_id) filter (where order_id is not null))[1], count(distinct order_id) filter (where order_id is not null) = 1,
         (array_agg(vendor_invoice_number) filter (where vendor_invoice_number is not null))[1]
    into v_vendor, v_one_v, v_order, v_one_o, v_num
    from (select vendor_id, order_id, vendor_invoice_number from public.wwd_invoices where id = any (v_ids)) x;
  if not coalesce(v_one_v, false) then v_vendor := null; end if;
  if not coalesce(v_one_o, false) then v_order := null; end if;
  -- already on file under the number as printed or as WWD keeps it
  if v_vendor is not null then
    select id into v_doc from public.vendor_links
     where vendor_id = v_vendor and kind in ('invoice', 'credit')
       and public.vin_norm(doc_number) in (public.vin_norm(p->>'vendor_invoice_number'), public.vin_norm(v_num))
     order by created_at limit 1;
  end if;
  v_num := coalesce(nullif(trim(p->>'vendor_invoice_number'), ''), v_num);
  return jsonb_build_object('placed', true, 'invoice_ids', to_jsonb(v_ids), 'vendor_id', v_vendor, 'order_id', v_order,
    'existing_doc', v_doc, 'doc_number', v_num,
    'kind', case when exists (select 1 from public.wwd_invoices where id = any (v_ids) and kind = 'credit')
                  and not exists (select 1 from public.wwd_invoices where id = any (v_ids) and kind <> 'credit') then 'credit' else 'invoice' end,
    'seqs', (select to_jsonb(array_agg(seq order by seq)) from public.wwd_invoices where id = any (v_ids)),
    'added', v_added);
end;
$$;

-- the seven Edenred PDFs of Oct 19 with an Invoice Summary page, as printed on them
update public.wwd_invoices i set posted_date = v.d::date
  from (values ('7202949', '2025-11-18'), ('7205215', '2025-11-19'), ('7207067', '2025-11-22'), ('7207066', '2025-11-22'),
               ('7207306', '2025-11-22'), ('7208442', '2025-11-20'), ('7208195', '2025-11-20')) v(seq, d)
 where i.seq = v.seq and i.posted_date is null and 'edenred' = any (i.sources);
