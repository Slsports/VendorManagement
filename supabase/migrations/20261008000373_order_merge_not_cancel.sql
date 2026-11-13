-- 0373 — A true duplicate is merged, never cancelled (Dana, Nov 13: "If any orders show up twice, for the identical order
-- and invoice cost, they should be merged, not shown as 'cancelled'. cancelled to me means we placed it and either we
-- cancelled it or the vendor did … When we merge records because they are true duplicates, I want all notes, etc on both
-- entries merged into the surviving record also" … "go on all").
--   • order_duplicate_merge(keep, dup): everything pointing at the copy (emails, files, invoices, payments, tasks, freight,
--     LS PO, status history …) moves to the kept order; every note of the copy (notes, shipment, credit, freight, free
--     shipping, freight %) is added to the kept order's, labelled; a blank field on the kept order is filled from the
--     copy; the further-along status wins; a line says what was merged. The copy is then removed from every list, count
--     and total; order_merges remembers it (its sheet key, PO and every field) so a sheet reload finds the kept order.
--   • Back-check: the 17 orders marked Cancelled as duplicates (Oct 21 clean-up, Oct 31, Nov 2) are merged this way.
set local lock_timeout = '5s';

create table if not exists public.order_merges (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kept_order_id   uuid not null references public.orders(id) on delete cascade,
  merged_order_id uuid not null,
  source_key      text,
  po_number       text,
  snapshot        jsonb not null,
  note            text,
  merged_by       uuid references public.profiles(id) on delete set null,
  merged_at       timestamptz not null default now()
);
comment on table public.order_merges is 'Orders merged into another as true duplicates (Dana, Nov 13): the copy''s every field, so a sheet reload finds the kept order.';
create index if not exists order_merges_kept on public.order_merges (kept_order_id);
create index if not exists order_merges_key on public.order_merges (organization_id, source_key) where source_key is not null;
alter table public.order_merges enable row level security;
drop policy if exists order_merges_read on public.order_merges;
create policy order_merges_read on public.order_merges for select to authenticated using (public.user_in_org(organization_id));
grant select on public.order_merges to authenticated;
grant all on public.order_merges to service_role;

drop function if exists public.order_duplicate_merge(uuid, uuid, text);
create or replace function public.order_duplicate_merge(p_keep uuid, p_dup uuid, p_note text, p_any_vendor boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare k public.orders%rowtype; d public.orders%rowtype; m jsonb; r record; c text; v_lbl text; v_cols text;
        v_rank constant text[] := array['open', 'awaiting_confirmation', 'confirmed', 'shipped', 'received', 'entered', 'ready_to_pay', 'paid'];
begin
  select * into k from public.orders where id = p_keep;
  select * into d from public.orders where id = p_dup;
  if k.id is null or d.id is null or k.id = d.id or k.organization_id <> d.organization_id
     or (k.vendor_id is distinct from d.vendor_id and not p_any_vendor) then
    raise exception 'Those are not two orders of one vendor' using errcode = '22023';
  end if;
  -- everything that points at the copy moves to the kept order (every table, found from the database's own links)
  for r in select c2.conrelid::regclass::text as tbl, a.attname as col, c2.confdeltype as del
             from pg_constraint c2 join pg_attribute a on a.attrelid = c2.conrelid and a.attnum = any (c2.conkey)
            where c2.contype = 'f' and c2.confrelid = 'public.orders'::regclass loop
    -- the kept order's own item lines stay; the copy's lines go with it
    if r.tbl in ('order_lines', 'public.order_lines') and exists (select 1 from public.order_lines where order_id = p_keep) then continue; end if;
    begin
      execute format('update %s set %I = $1 where %I = $2', r.tbl, r.col, r.col) using p_keep, p_dup;
    exception when unique_violation then
      if r.del <> 'c' then raise; end if; -- the kept order already has its own (one shipment request, one LS PO)
    end;
  end loop;
  insert into public.order_merges (organization_id, kept_order_id, merged_order_id, source_key, po_number, snapshot, note, merged_by)
  values (k.organization_id, k.id, d.id, d.source_key, d.po_number, to_jsonb(d), p_note, auth.uid());
  delete from public.orders where id = p_dup;

  -- the kept order: its own values win, its blanks come from the copy
  m := to_jsonb(d) || jsonb_strip_nulls(to_jsonb(k));
  if cardinality(coalesce(k.store_codes, '{}')) = 0 and cardinality(coalesce(d.store_codes, '{}')) > 0 then m := jsonb_set(m, '{store_codes}', to_jsonb(d.store_codes)); end if;
  -- every note of the copy is kept, labelled
  v_lbl := 'From the merged copy' || coalesce(' (PO ' || nullif(trim(d.po_number), '') || ')', '');
  foreach c in array array['notes', 'shipment_notes', 'credit_notes', 'freight_notes', 'free_shipping_note', 'freight_pct_note'] loop
    if nullif(trim(to_jsonb(d) ->> c), '') is not null and strpos(coalesce(to_jsonb(k) ->> c, ''), trim(to_jsonb(d) ->> c)) = 0 then
      m := jsonb_set(m, array[c], to_jsonb(concat_ws(E'\n', nullif(to_jsonb(k) ->> c, ''), v_lbl || ': ' || trim(to_jsonb(d) ->> c))));
    end if;
  end loop;
  m := jsonb_set(m, '{notes}', to_jsonb(concat_ws(E'\n', nullif(m ->> 'notes', ''),
         format('Merged %s: the same order was also entered as %s%s%s%s.%s', to_char(current_date, 'FMMM/FMDD/YYYY'),
                coalesce('PO ' || nullif(trim(d.po_number), ''), 'an order with no PO'),
                coalesce(' (' || nullif(trim(d.description), '') || ')', ''), coalesce(', dated ' || to_char(d.order_date, 'FMMM/FMDD/YYYY'), ''),
                coalesce(', $' || to_char(coalesce(d.final_cost, d.est_cost), 'FM999,999,990.00'), ''), coalesce(' ' || nullif(trim(p_note), ''), '')))));
  -- the further-along status wins (a cancelled copy never cancels the kept order)
  if d.status <> 'cancelled' and (k.status = 'cancelled' or coalesce(array_position(v_rank, d.status::text), 0) > coalesce(array_position(v_rank, k.status::text), 0)) then
    m := jsonb_set(m, '{status}', to_jsonb(d.status::text));
  end if;
  select string_agg(quote_ident(attname), ', ' order by attnum) into v_cols
    from pg_attribute where attrelid = 'public.orders'::regclass and attnum > 0 and not attisdropped and attgenerated = ''
     and attname not in ('id', 'organization_id', 'created_at', 'vendor_id');
  execute format('update public.orders set (%s) = (select %s from jsonb_populate_record(null::public.orders, $1)) where id = $2', v_cols, v_cols) using m, p_keep;
end;
$$;
revoke execute on function public.order_duplicate_merge(uuid, uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.order_duplicate_merge(uuid, uuid, text, boolean) to service_role;

-- the review card "The same order twice?": Keep this one merges the other into it
create or replace function public.order_duplicate_answer(p_item uuid, p_keep uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.review_items%rowtype; a uuid; b uuid;
begin
  select * into r from public.review_items where id = p_item for update;
  if r.id is null or r.kind <> 'order_duplicate' then raise exception 'Card not found' using errcode = '23503'; end if;
  if not (public.user_in_org(r.organization_id) and public.user_can_edit()) then raise exception 'Only admins, managers and buyers answer this' using errcode = '42501'; end if;
  if r.status <> 'pending' then return; end if;
  a := (r.details->'a'->>'id')::uuid; b := (r.details->'b'->>'id')::uuid;
  if p_keep is null then
    update public.review_items set status = 'rejected', resolved_by = auth.uid(), resolved_at = now(), resolution_note = 'Not the same order: both kept' where id = p_item;
    return;
  end if;
  if p_keep not in (a, b) then raise exception 'Pick one of the two orders' using errcode = '22023'; end if;
  perform public.order_duplicate_merge(p_keep, case when p_keep = a then b else a end,
                                       'the same order (' || coalesce((select full_name from public.profiles where id = auth.uid()), 'confirmed') || ', ' || to_char(current_date, 'FMMM/FMDD/YYYY') || ')');
  update public.review_items set status = 'accepted', resolved_by = auth.uid(), resolved_at = now(),
         resolution_note = 'Kept ' || coalesce((select po_number from public.orders where id = p_keep), 'one order') || '; the other merged into it'
   where id = p_item;
end;
$$;
revoke execute on function public.order_duplicate_answer(uuid, uuid) from public, anon;
grant execute on function public.order_duplicate_answer(uuid, uuid) to authenticated, service_role;

-- ---- back-check: the orders marked Cancelled as duplicates are merged into the order each one copied ---------------------
do $$
declare p record;
begin
  for p in select * from (values
    ('195da550-b18c-4d74-a917-e75fa548aac0'::uuid, 'b7fcf957-a920-40c7-a88c-7f78acdc228f'::uuid, 'The same Bearpaw show order (Dana, 11/2/2026: keep B671841).', false),
    ('195da550-b18c-4d74-a917-e75fa548aac0', 'c98e55cf-01b4-4bf6-b1c0-5bf4b1917323', 'The same Bearpaw show order (Dana, 11/2/2026: keep B671841).', false),
    ('777f0131-8323-4fdc-a1a3-2512235ef3e2', 'a1634460-ec6f-4805-85b5-fb524d9c3042', 'The booth sheet that became the SPR2026 orders (Oct 21 clean-up).', false),
    ('1b6704b2-ffba-40d6-a9ec-34ee6bece4f1', '6b4131cb-34c9-4475-ac5e-f82e662238f9', 'Made from the order email; the same order as #76203 (Oct 21 clean-up).', false),
    ('ed47c814-9f08-4b3c-a8b8-943fe5702463', 'be875185-cbf5-4713-8375-8f570659f098', 'Made from the show order confirmation email; the same order as #2907732 (Oct 21 clean-up).', false),
    ('6fbc6505-d7f1-4729-912e-943c522aa38c', '6b5bf86d-5a9b-4122-9d36-7e9059714ff0', 'Entered twice on the sheet: the same $628.58 order (Oct 21 clean-up).', false),
    ('71ac6489-e2ba-4c12-916d-2c80586471a8', 'f7e59146-089d-4da3-81e7-5081877e3521', 'Made from the Faire email; the same order as MENSTHERMALS2-21-26 (Oct 21 clean-up).', false),
    ('6644828c-b1b1-489a-88ad-aacd787d7a3d', 'bb3df4f3-421e-4713-8d5a-da0bdd10e347', 'Made from the vendor''s Feb 11 email covering LAZYONE1-30-26 and LAZYONE2426 (Oct 21 clean-up).', false),
    ('6abab5d2-e6a0-4377-8478-9a0b799f9d5a', '74118d59-9900-426d-adfb-207e3aa6465e', 'NuORDER copy of #356914 (Oct 21 clean-up).', false),
    ('696bec1c-73de-4cf3-85f8-047806db702b', 'ecf8ee80-eb9d-4926-99ef-ac48bf88684d', 'Made from an order-received notice (Oct 21 clean-up).', false),
    ('4398c5f1-5762-44b0-a3a3-1ed358de78f1', 'cc10b608-57a6-496d-b13f-e76437cd1fc9', 'Made from an order-received notice (Oct 21 clean-up).', false),
    ('4773213c-c7ef-4339-bca9-b647052ef78c', 'cc23dd00-2934-4275-858f-ece6b19f22e8', 'Made from the Shopify email #1537; the Jul 13 Scope order (Oct 21 clean-up).', false),
    ('9c10f800-e00d-4fbd-93ca-24cfc43d87b8', '698276d5-917f-4730-b322-eab3a0c534c7', 'Made from the Faire email; the same order as SHARKEYES82726 (Oct 21 clean-up).', false),
    ('dbb58ce7-110c-4ad2-9dd3-2c739b7d4703', 'f7b69585-973f-4640-aec5-95cd70c680be', 'VMS had Basic Spirit twice, once under "Spirit" (Oct 21 clean-up).', true),
    ('a3c52f83-87ad-4e6e-8bba-2ca763fcde0c', 'e206ea5b-3149-46dd-9394-cd14e5333f7d', 'Made from an order-received notice (Oct 21 clean-up).', false),
    ('1bcae7f1-9507-4a6f-b536-d8168c1ef022', '9a0c9d7f-4fde-422a-82fb-a6a6cdf75d64', 'Made from the vendor''s email; the Feb 4 show order I88198 (Oct 21 clean-up).', false),
    ('1bcae7f1-9507-4a6f-b536-d8168c1ef022', '74d95a3b-780b-4213-be5c-a11157369a52', 'The same order as SO 88198 (Dana, Oct 31).', false)
  ) x(keep, dup, note, any_vendor) loop
    if exists (select 1 from public.orders where id = p.keep) and exists (select 1 from public.orders where id = p.dup and status = 'cancelled') then
      -- the copy's "Duplicate of …, cancelled" wording is replaced by the merge line
      update public.orders set notes = nullif(trim(regexp_replace(regexp_replace(coalesce(notes, ''),
               '\s*Duplicate of [^:]*, cancelled [0-9/]+:[^\n]*', '', 'g'), '\s*Oct 21, 2026 clean-up \(Dana\): not a separate order[^\n]*', '', 'g')), '')
       where id = p.dup;
      perform public.order_duplicate_merge(p.keep, p.dup, p.note, p.any_vendor);
    end if;
  end loop;
end $$;
-- the kept orders' "Also entered as …" lines from the old merge stay as they are (they say the same thing)

-- a "The same order twice?" card whose order is gone (merged) has nothing left to ask
update public.review_items set status = 'accepted', resolved_at = now(), resolution_note = 'One of the two orders was merged into the other'
 where kind = 'order_duplicate' and status = 'pending'
   and (not exists (select 1 from public.orders where id = (details -> 'a' ->> 'id')::uuid)
        or not exists (select 1 from public.orders where id = (details -> 'b' ->> 'id')::uuid));
