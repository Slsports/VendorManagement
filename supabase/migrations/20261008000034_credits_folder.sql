-- 0055 — A Credits folder right next to Invoices in a vendor's Documents (Dana, Oct 8): credit memos
-- and credit notices get their own kind. Documents already filed as invoices whose name says credit move.
alter table public.vendor_links drop constraint if exists vendor_links_kind_check;
alter table public.vendor_links add constraint vendor_links_kind_check check (kind in ('catalog', 'price_list', 'order_form', 'specials', 'website', 'other', 'invoice', 'credit', 'confirmation', 'order', 'packing_slip', 'payment', 'freight_bill', 'delivery_receipt'));
update public.vendor_links set kind = 'credit'
 where kind in ('invoice', 'other') and (coalesce(file_name, '') || ' ' || label) ~* '(credit|\mcm\s?\d|\mrma\M|return authori[sz]ation)';
