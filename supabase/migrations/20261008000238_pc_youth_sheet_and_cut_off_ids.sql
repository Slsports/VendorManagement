-- 0238 — Dana, Oct 24: "Attach the youth closeout sheet to the kids order, the ps 317 bl probably has something else after
-- it but we dont know what it is lol, that one, or anything like it will have to stop after the bl."
--   • The three versions of "Shaver Lake Sports PC closeout youth Oct 2026.xlsx" (three emails, different files) go on the
--     kids order (PO planet101926).
--   • Planet Cotton's rule says a cut-off Item Code stops where the print stops (order-check also trims "..." from every
--     vendor's Item Codes).

set local lock_timeout = '5s';

update public.vendor_links set order_id = '2fef3536-3041-4021-b52a-b59b4f1badb9'
 where id in ('de939397-d134-4ced-9e10-7c780a9bda31', '363d9ddd-2986-4b55-b1e6-0e36a1dc268b', '16cbab72-a00c-40e8-a3ef-559c0b33484c')
   and order_id is null and exists (select 1 from public.orders where id = '2fef3536-3041-4021-b52a-b59b4f1badb9');

update public.vendors
   set vendor_id_rule = vendor_id_rule || ' An Item Code cut off on the paper ("PS 317 BL...") stops where the print stops: PS 317 BL.'
 where id = '8ddde2cd-7328-45b6-8219-b10a8bf97587' and vendor_id_rule not like '%cut off on the paper%';
