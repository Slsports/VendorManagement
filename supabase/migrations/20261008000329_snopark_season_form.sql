-- The State sends a new Report of Operations form every season (Dana, Nov 10: "You have to use this one and it auto
-- calculates the amounts owed"). Each season can carry its own form file, uploaded on the Sno-Park page and filed under
-- CA Snow Park; the snopark function fills that file, else the blank 2026-2027 form built into it.
alter table public.snopark_seasons add column if not exists form_link_id uuid references public.vendor_links(id) on delete set null;
alter table public.vendor_links drop constraint if exists vendor_links_kind_check;
alter table public.vendor_links add constraint vendor_links_kind_check check (kind in ('catalog', 'price_list', 'order_form', 'specials', 'website', 'other', 'invoice', 'credit', 'confirmation', 'order', 'ls_po', 'packing_slip', 'payment', 'freight_bill', 'delivery_receipt', 'image', 'approved_proof', 'damage_photo', 'sales_report', 'proof', 'inventory_count', 'snopark_report', 'snopark_scan', 'snopark_form'));
