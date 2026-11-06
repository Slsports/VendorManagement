-- An undated paid order from the order guide is found when the items line up; not when they do not; null on a tie.
begin;
select '00000000-0000-0000-0000-000000000001'::uuid as org \gset
insert into public.vendors (organization_id, name) values (:'org', 'Test Cotton 0316') returning id as v \gset
insert into public.orders (organization_id, vendor_id, status, source, po_number, description)
values (:'org', :'v', 'paid', 'order_guide', '26328-T', 'SL MARINA HOODIES,TSHIRTS,TANKS') returning id as paid \gset
insert into public.order_lines (organization_id, order_id, description, quantity)
values (:'org', :'paid', 'Marina hoodie adult forest', 12), (:'org', :'paid', 'Marina hoodie adult charcoal', 12), (:'org', :'paid', 'Marina tank womens', 6);
insert into public.orders (organization_id, vendor_id, status, source, po_number, description)
values (:'org', :'v', 'paid', 'order_guide', 'HATS-T', 'Trucker hats') returning id as hats \gset
insert into public.order_lines (organization_id, order_id, description, quantity) values (:'org', :'hats', 'Trucker hat lake logo', 24);
select set_config('t.v', :'v', false), set_config('t.paid', :'paid', false), set_config('t.hats', :'hats', false);
do $$ declare v uuid := current_setting('t.v')::uuid; paid uuid := current_setting('t.paid')::uuid; hats uuid := current_setting('t.hats')::uuid; begin
  if public.order_match_undated(v, 'SL Marina adult hoodies, 12 colors. Marina hoodie adult forest; Marina hoodie adult charcoal') <> paid then
    raise exception 'the hoodie order was not matched'; end if;
  if public.order_match_undated(v, 'Sunglasses replenishment, polarized aviator') is not null then
    raise exception 'sunglasses matched an order'; end if;
  if public.order_match_undated(v, 'Trucker hat lake logo') <> hats then raise exception 'hats not matched'; end if;
  if not (public.text_item_words('Hoodies and Tanks for kids') @> array['HOODI','TANK'] and public.text_item_words('Hoodie boxes lure') @> array['HOODI','BOX','LUR'] and cardinality(public.text_item_words('Hoodies and Tanks for kids')) = 2) then
    raise exception 'words: %', public.text_item_words('Hoodies and Tanks for kids'); end if;
end $$;
-- a tie: two undated orders equally close → null
insert into public.orders (organization_id, vendor_id, status, source, po_number, description)
values (:'org', :'v', 'entered', 'order_guide', '26329-T', 'SL MARINA HOODIES,TSHIRTS,TANKS') returning id as paid2 \gset
insert into public.order_lines (organization_id, order_id, description, quantity)
values (:'org', :'paid2', 'Marina hoodie adult forest', 12), (:'org', :'paid2', 'Marina hoodie adult charcoal', 12), (:'org', :'paid2', 'Marina tank womens', 6);
do $$ declare v uuid := current_setting('t.v')::uuid; begin
  if public.order_match_undated(v, 'SL Marina adult hoodies. Marina hoodie adult forest; Marina hoodie adult charcoal') is not null then
    raise exception 'a tie should match nothing'; end if;
end $$;
rollback;
