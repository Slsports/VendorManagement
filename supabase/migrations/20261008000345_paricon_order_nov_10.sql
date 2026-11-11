-- 0345 — Paricon order of Nov 10, 2026, filled in (Dana, Nov 11: "I sent the order yesterday, you can see our emails" …
-- "Yes"). Dana emailed Ted Morton last year's order sheet (still PO PARICON-11-20-25, FOB Worldwide Kent, same 10 items and
-- 2025 prices, $9,820.77), then corrected the PO to Paricon11-10-26 and told him to ship direct. VMS read the old PO in the
-- sheet and filed the email and sheet on last year's order (PARICON11-20-25, paid), and made an empty order from the
-- correction email. Ted: ships Nov 12, 7 pallets, 94 units, 2,559 lbs, freight quote $2,274; VMS made two freight quotes
-- (and two tasks for Trevor) from his two emails.
--   • Paricon11-10-26 gets the 10 lines from the sheet, its cost, date and a plain note.
--   • The order email and its sheet move from last year's order to this one.
--   • The two freight quotes become one (details + $2,274); the second one's task closes as made by mistake.
set local lock_timeout = '5s';

do $$
declare v_new uuid := '3d380dce-90f7-4981-b40d-b8d6142f2f31'; v_old uuid := '2f2da074-3f71-4b71-9964-962653c329cb'; v_org uuid;
begin
  select organization_id into v_org from public.orders where id = v_new;
  if v_org is null then return; end if;   -- not on this database (local tests)

  update public.orders set order_date = '2026-11-10', est_cost = 9820.77, description = 'Sleds, saucers, tubes & snow toys',
         notes = 'Ordered by email Nov 10, 2026 (Dana to Ted Morton), with last year''s order sheet re-sent: same 10 items and prices, still showing PO PARICON-11-20-25 and FOB Worldwide Kent. Dana corrected the PO to Paricon11-10-26 that night and told Ted to ship direct, not to Kent (Nov 11). Ted: ships Nov 12, 7 pallets, 94 shipping units, 2,559 lbs; his freight quote is $2,274. Paricon offers prepaid freight only on orders of $25,000 or more.'
   where id = v_new;

  if not exists (select 1 from public.order_lines where order_id = v_new) then
    insert into public.order_lines (organization_id, order_id, sort_order, vendor_item_id, description, quantity, unit_cost, upc)
    values (v_org, v_new, 0, '605', 'Snow & Sand Block Maker, Red', 24, 3.498, '068660810056'),
           (v_org, v_new, 1, '615', 'Hot Seat, Assorted Colors', 24, 3.2118, '068660816157'),
           (v_org, v_new, 2, '626', 'Flying Saucer, Assorted Colors', 504, 6.4554, '068660816263'),
           (v_org, v_new, 3, '648', 'Winter Lightning, Assorted Colors', 336, 10.388, '068660826484'),
           (v_org, v_new, 4, '666', 'Winter Trek, Blue', 24, 32.4572, '068660816669'),
           (v_org, v_new, 5, 'S-20', 'Snow Castle Kit, Red', 12, 16.3982, '696525190205'),
           (v_org, v_new, 6, 'S-34', 'Snow Shovel w/red plastic blade & handle, wooden shaft', 24, 3.9432, '068660000341'),
           (v_org, v_new, 7, 'PEF38-G', 'Large Saucer 38" Dia. Green', 25, 28.09, null),
           (v_org, v_new, 8, 'PEF38-B', 'Large Saucer 38" Dia. Blue', 25, 28.09, null),
           (v_org, v_new, 9, 'BI-32', 'Heavy Duty Tube (Small) 32" Diameter', 32, 13.78, '696525512486');
  end if;

  -- the order email and its sheet belong to this order, not last year's
  update public.vendor_links set order_id = v_new where id = '381ddd42-a31d-4a8e-a8c7-754c632f08a4' and order_id = v_old;
  update public.emails set order_id = v_new,
         order_scan = jsonb_build_object('result', 'linked', 'order_id', v_new, 'po', 'Paricon11-10-26', 'note', 'Moved from last year''s order (Dana, Nov 11): the sheet still showed last year''s PO.')
   where id = '3622d9c7-061c-447b-b477-eeb57dcb1457';

  -- one freight quote: Ted's details plus his $2,274
  update public.freight_quotes set vendor_cost = 2274,
         details = details || jsonb_build_object('notes', 'Ted Morton (Nov 11): 7 pallets, 94 shipping units, 2,559 lbs, ready Nov 12; his quote to ship it here is $2,274 (carrier not named). Pallet sizes and freight class not given yet. Ships direct, not to Worldwide Kent.')
   where id = 'd07c7c6b-b7f4-4b25-bcf7-8b259a4281b6';
  update public.tasks set done_at = now(), closed_how = 'mistake',
         done_note = 'Made by mistake: the same Paricon shipment as the other freight quote task for PO Paricon11-10-26; the $2,274 is on that quote now.'
   where id = 'e570bb0c-18a0-4607-92b1-0ae3fc7af27a' and done_at is null;
  delete from public.freight_quotes where id = 'eca6a338-5bec-4fa9-972f-dab4a48c35de';
  update public.emails set order_id = v_new where id = '6e0d4360-9e1b-4e0a-b118-1b0e69698ed2';
end $$;
