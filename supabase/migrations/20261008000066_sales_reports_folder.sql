-- 0087 — Sales reports folder (Dana, Oct 11): formatted LS sales reports (spec v49) are kept on each vendor
-- (kind sales_report); the upload on the vendor page will file them here too.
alter table public.vendor_links drop constraint if exists vendor_links_kind_check;
alter table public.vendor_links add constraint vendor_links_kind_check check (kind in ('catalog', 'price_list', 'order_form', 'specials', 'website', 'other',
  'invoice', 'credit', 'confirmation', 'order', 'ls_po', 'packing_slip', 'payment', 'freight_bill', 'delivery_receipt', 'image', 'approved_proof', 'damage_photo',
  'sales_report'));
