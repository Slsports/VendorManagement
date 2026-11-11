-- The 2026-2027 packet went back by hand (Dana, Nov 2: the signed agreement and the first order, 20 day books and 10
-- season books, from billing@; Monica confirmed Nov 3 and the books shipped Nov 4). Her reply is not in VMS, so the
-- packet task stayed open and VMS tried to prepare a first order on Nov 10 (stopped for want of a signature). Close the
-- task, mark the packet filed (its documents are), and record the first order as sent so the next one is #2.
do $$ declare s record; v_dana uuid; v_order uuid; begin
  select id, organization_id into s from public.snopark_seasons where label = '2026-2027' limit 1;
  if s.id is null then return; end if;
  select id into v_dana from public.profiles where organization_id = s.organization_id and lower(email) = 'dana@shaverlakesports.com' limit 1;
  update public.tasks set done_at = now(), done_by = v_dana, closed_how = 'request', remind_at = null, draft_id = null,
         done_note = 'Dana sent the signed agreement and the first order on Nov 2, 2026 (Monica confirmed Nov 3; the books shipped Nov 4, FedEx 879748712491). Closed by Claude at Dana''s direction, Nov 10.'
   where organization_id = s.organization_id and auto_key = 'snopark_packet:' || s.id and done_at is null;
  update public.snopark_seasons set packet_status = case when packet_status = 'error' then 'filed' else packet_status end, packet_error = null, packet_filed_at = coalesce(packet_filed_at, now()) where id = s.id;
  if not exists (select 1 from public.snopark_orders where season_id = s.id and seq = 1) then
    v_order := public.snopark_order_start(s.id, 20, 10, '2026-11-02', v_dana);
    update public.snopark_orders set status = 'sent', sent_on = '2026-11-02',
           notes = 'Sent by Dana on Nov 2, 2026 with the signed vendor agreement (reply in the State''s Vendor Registration conversation from billing@). Entered by Claude Nov 10.'
     where id = v_order;
  end if;
end $$;
