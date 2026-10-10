-- 0083 — Damaged Items folder (Dana, Oct 10): "images of damaged items which we would use to attach to a vendor
-- return email". Vendor documents get a Damaged Items folder (kind damage_photo).
alter table public.vendor_links drop constraint if exists vendor_links_kind_check;
alter table public.vendor_links add constraint vendor_links_kind_check check (kind in ('catalog', 'price_list', 'order_form', 'specials', 'website', 'other',
  'invoice', 'credit', 'confirmation', 'order', 'ls_po', 'packing_slip', 'payment', 'freight_bill', 'delivery_receipt', 'image', 'approved_proof', 'damage_photo'));
