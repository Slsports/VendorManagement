-- 0349 — Salter's invoice INV-122386 ($210.26) filed under "HAPPY" moves to Salter's Distributing (Dana, Nov 12: "Happy is
-- not a vendor … Yes move invoice to Salters"). Cat forwarded it as "Salter's Invoice - Happy"; HAPPY came from Lightspeed,
-- where it is the made-up vendor on the assembled s'mores kits (Dana: "there really is no vendor"). Bill.com has it as a
-- paid Salter's bill, so it is matched and shows Paid.
set local lock_timeout = '5s';

do $$ declare v_salters uuid; v_org uuid; begin
  select id, organization_id into v_salters, v_org from public.vendors where id = 'a4a0b8b9-049c-4c57-869b-9669d870fa86';
  if v_salters is null or not exists (select 1 from public.vendor_links where id = '5701204e-0dd7-4ce2-b825-59769486b8cc') then return; end if;
  update public.vendor_links set vendor_id = v_salters,
         notes = 'From an email: Fw: Salter''s Invoice - Happy. Moved from "HAPPY" to Salter''s (Dana, Nov 12): Happy is not a vendor.'
   where id = '5701204e-0dd7-4ce2-b825-59769486b8cc';
  perform public.billcom_match_papers(v_org);
end $$;
