\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Edenred PDFs: placed by Worldwide number, else by vendor invoice number and amount; new numbers added; blanks filled, nothing overwritten'
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'EDENTEST LURES') returning id as v \gset
insert into public.wwd_invoices (organization_id, seq, kind, wwd_vendor_name, vendor_id, vendor_invoice_number, amount, sources) values
  ('00000000-0000-0000-0000-000000000001', '7300001', 'invoice', 'Edentest Lures', :'v', '100056IN', 394.44, array['edenred']),
  ('00000000-0000-0000-0000-000000000001', '7300002', 'invoice', 'Edentest Lures', :'v', '100056IN', 394.44, array['edenred']),
  ('00000000-0000-0000-0000-000000000001', '7300003', 'credit', 'Edentest Lures', :'v', 'CM-9', -50, array['edenred']);
insert into public.vendor_links (organization_id, vendor_id, kind, label, url, doc_number) values ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'on file', 'https://example.com/inv.pdf', '0100056-IN') returning id as doc \gset

-- by Worldwide number (leading zero on the summary page); the blank PO is filled, the invoice number is not overwritten
select (r->>'placed')::boolean and jsonb_array_length(r->'invoice_ids') = 1 and r->>'vendor_id' = :'v' and r->>'kind' = 'invoice' and r->'seqs' = '["7300001"]' and r->>'existing_doc' = :'doc' as by_wwd_number
  from public.wwd_edenred_place('00000000-0000-0000-0000-000000000001', '{"seq":"07300001","vendor_invoice_number":"OTHER-1","amount":394.44,"po_number":"PO-77"}') r;
select po_number = 'PO-77' and vendor_invoice_number = '100056IN' as blanks_only from public.wwd_invoices where seq = '7300001';
-- no summary page: the vendor's number as printed ("0100056-IN") and the amount find both WWD bills of it
select (r->>'placed')::boolean and r->'seqs' = '["7300001", "7300002"]' and r->>'existing_doc' = :'doc' as by_vendor_number
  from public.wwd_edenred_place('00000000-0000-0000-0000-000000000001', '{"seq":"","vendor_invoice_number":"0100056-IN","amount":394.44}') r;
-- a credit
select r->>'kind' = 'credit' and r->>'existing_doc' is null as credit
  from public.wwd_edenred_place('00000000-0000-0000-0000-000000000001', '{"seq":"07300003","vendor_invoice_number":"CM-9","amount":50,"credit":true}') r;
-- a Worldwide number VMS has never seen is added
select (r->>'placed')::boolean and (r->>'added')::boolean as added
  from public.wwd_edenred_place('00000000-0000-0000-0000-000000000001', '{"seq":"07399999","vendor_invoice_number":"A-1","vendor_name":"Edentest Lures","amount":10,"invoice_date":"2025-11-12","posted_date":"2025-11-20"}') r;
select kind = 'invoice' and amount = 10 and sources = array['edenred'] and wwd_date is null and vendor_invoice_date = '2025-11-12' as new_row from public.wwd_invoices where seq = '7399999';
-- nothing to go on
select not (r->>'placed')::boolean as unplaced
  from public.wwd_edenred_place('00000000-0000-0000-0000-000000000001', '{"seq":"","vendor_invoice_number":"NOPE-404","amount":1}') r;
select public.vin_norm(' 0100056-in ') = '100056IN' and public.vin_norm('---') is null as norm;

-- people cannot call it
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', false) is not null as dana_in;
do $$ begin
  perform public.wwd_edenred_place('00000000-0000-0000-0000-000000000001', '{}');
  raise exception 'called by a person';
exception when insufficient_privilege then null; end $$;
reset role;
select set_config('request.jwt.claims', '', false) is not null as service;

delete from public.wwd_invoices where seq in ('7300001', '7300002', '7300003', '7399999');
delete from public.vendor_links where id = :'doc';
delete from public.vendors where id = :'v';
