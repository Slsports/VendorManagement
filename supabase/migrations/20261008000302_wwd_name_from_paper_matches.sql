-- 0302 — A WWD invoice that gets its vendor name from the paper is matched to the vendor right away (Nov 3, LaserVault).
--   Confirmed cause: the older WWD invoices were already in VMS from WWD's payment list without a vendor name. When the
--   LaserVault paper was read, wwd_edenred_place filled in WWD's name but did not run the vendor match, so papers for AURORA,
--   JACOB ASH, MUELLER, SMITH OPTICS, TRIPLE T and WORLD FAMOUS SPORTS were left "WWD invoice has no vendor yet".
--   Now the match runs when the paper fills in the name; the papers skipped that way are read again.
set local lock_timeout = '5s';

create or replace function public.wwd_edenred_place(p_org uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
      -- the name the paper filled in finds the vendor (0302)
      if exists (select 1 from public.wwd_invoices where id = any (v_ids) and vendor_id is null and carrier_id is null and wwd_vendor_name is not null) then
        perform public.wwd_relink(p_org);
      end if;
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

revoke execute on function public.wwd_edenred_place(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.wwd_edenred_place(uuid, jsonb) to service_role;

-- back-fix: match the names the papers filled in, then read the skipped papers again
do $$
declare o record;
begin
  for o in select id from public.organizations loop perform public.wwd_relink(o.id); end loop;
end $$;
with t as (
  select a.id, a.email_id from public.email_attachments a join public.emails e on e.id = a.email_id
   where e.mailbox_id is null and (e.from_email ilike '%@edenredpayinvoice.com' or e.subject ilike '%laservault%')
     and a.vendor_link_id is null and a.accounting_skip = 'Edenred: WWD invoice has no vendor yet'
), u as (update public.email_attachments a set accounting_skip = null from t where a.id = t.id returning a.email_id)
update public.emails set paper_scanned_at = null where id in (select email_id from u);
