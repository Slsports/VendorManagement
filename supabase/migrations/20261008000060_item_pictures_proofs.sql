-- 0081 — Pictures and proofs (Dana, Oct 10): "If a vendor sends images of items they would go in that folder"
-- (Images), going back 12 months; artwork proofs stay in the email, and a new Approved proofs folder holds the
-- final proof once approved ("we will click to save in that folder").
alter table public.vendor_links drop constraint if exists vendor_links_kind_check;
alter table public.vendor_links add constraint vendor_links_kind_check check (kind in ('catalog', 'price_list', 'order_form', 'specials', 'website', 'other',
  'invoice', 'credit', 'confirmation', 'order', 'ls_po', 'packing_slip', 'payment', 'freight_bill', 'delivery_receipt', 'image', 'approved_proof'));

-- gmail-sync's pictures step: looked at for item pictures.
alter table public.emails add column if not exists images_scanned_at timestamptz;
create index if not exists emails_images_queue_idx on public.emails (organization_id, received_at desc)
  where images_scanned_at is null and direction = 'in' and vendor_id is not null and has_attachments;
