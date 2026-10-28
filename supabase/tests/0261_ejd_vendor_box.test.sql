\set ON_ERROR_STOP on
\pset footer off
\echo '>>> 0261: a paper read again fills its Stihl/EJD tag'
reset role;
insert into public.vendors (organization_id, name, billcom_check) values ('00000000-0000-0000-0000-000000000001', 'BC261 EJD', true) returning id as v \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, received_at) values
  ('00000000-0000-0000-0000-000000000001', :'v', 'invoice', 'EJD dropship', 'x/bc261.pdf', current_date - 2) returning id as l \gset
select public.billcom_paper_read(:'l', '9689012976', 'STAN92526', 15742.80, 'Stihl');
select billed_as = 'Stihl' and billcom_read_at is not null as stihl_tag from public.vendor_links where id = :'l';
delete from public.vendor_links where vendor_id = :'v';
delete from public.vendors where id = :'v';
