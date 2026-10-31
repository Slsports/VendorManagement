-- 0269 — Dana, Oct 30 ("go on all 3, read quotes from my inbox too"):
--
-- 1. Becker's fall order. It was on Dana's sheet as PO BECKER020526 (WWD spring show, Open Orders) with no amount and
--    no items, while Becker, Sunny and the routing company all use PO BECKER2926. Dana's rule ("whenever a vendor
--    already has a PO showing for us, we adopt their PO" once it is shipping or about to; in the order or confirmation
--    stage they are asked to correct it): this one is getting ready to ship, so it takes theirs. Filled from Dana's
--    final confirmation of Feb 12 (2-9-26 BECKER SHOW CONFIRMATION-Final.xlsx): 273 dozen, $17,413.80, 50 items;
--    confirmed; the Feb and Oct emails tied to it; the two routing-company quotes tied to it (VMS reads Dana's $1,043
--    XPO price from her own emails, part 3, and approves them).
-- 2. Manufacturers Exchange (Sunny Lakhani, Lance Kessler; manxch.com) is a rep group, not a vendor. Its mail and
--    files go to the vendor each one is about: Becker, G & S Originals, Bluestone NYC, Royal Deluxe, Silverstar NYC,
--    A-One, Steintex become its lines; mail naming several lines (or none) stays with the rep group, tagged to each line
--    it names; files that name no single line go on the rep group. The vendor record stays, inactive, only because
--    Worldwide lists "Manufacturer's Exchange" as vendor #10053 and the show listings use it.
--    "MANUFACTURERS EXCH / SILVERSTAR NYC" is renamed SILVERSTAR NYC (the old name kept as an alias).
-- 3. Quotes we state ourselves. The freight quote reader now also reads mail we send (orders@ and Dana's own inbox),
--    and the mail coming in to Dana's own inbox. When our email gives the price WE got or chose ("a quote from my son's
--    company for $1043 for XPO so we will be using them"), the vendor's open quotes for that order are approved at our
--    price and their tasks close; the order's freight is set. From Dana's own inbox VMS keeps only the carrier and the
--    amount (no text from the email), and a quote arriving there makes its task for Dana, not Trevor.

set local lock_timeout = '5s';

-- ---- 1. Becker -----------------------------------------------------------------------------------------------------
do $$
declare
  o   constant uuid := 'a95b5bae-df7f-4b40-ae19-638e226ecf98';
  org uuid;
begin
  select organization_id into org from public.orders where id = o and po_number = 'BECKER020526';
  if org is null then return; end if;
  update public.orders set po_number = 'BECKER2926', po_auto = false, status = 'confirmed', est_cost = 17413.80,
         notes = concat_ws(E'\n', nullif(notes, ''),
           'PO changed from our BECKER020526 to their BECKER2926 on 10/30/2026: Becker''s PO, the order is getting ready to ship (Dana, Oct 30).',
           'Order: Dana''s final confirmation to Sunny (Manufacturers Exchange) on Feb 12, 2026: 273 dozen, $17,413.80. She swapped the quantities on 63350 (12 to 9), 63360 (9 to 12) and added 3 dozen 63632.'),
         freight_notes = concat_ws(E'\n', nullif(freight_notes, ''), 'XPO pick-up Monday Nov 2 or Tuesday Nov 3, 2026, scheduled through our own freight connection (Dana, Oct 30).')
   where id = o;
  delete from public.order_lines where order_id = o;
  insert into public.order_lines (organization_id, order_id, sort_order, vendor_item_id, description, quantity, unit_cost)
  select org, o, x.n, x.vid, x.d, x.q, x.c from (values
(1, '948', 'Mens One Size 3 hole acrylic knit superstretch face mask', 6, 31.8, 190.8),
(2, '20235', 'Girls 4-6x Tusser snowboard glove w. strap, snowflake embroidery, Thinsulate, waterproof', 8, 78, 624),
(3, '20236', 'Girls 7-16 Tusser snowboard glove w. strap, snowflake embroidery, Thinsulate, waterproof', 6, 81, 486),
(4, '33081', 'Mens S/M & L/XL Polypro glove liner - Black', 3, 54, 162),
(5, '33092', 'Mens S/M & L/XL Ragwool Thinsulate glove, full Suede leather palm- Natural', 2, 84, 168),
(6, '34114', 'Tod. 2-4 Stretch glove- solids', 7, 6.6, 46.2),
(7, '36114', 'Ladies One Size Solid color stretch gloves', 6, 7.8, 46.8),
(8, '54146', 'Boys 4-7 Heathered Taslon Ski Glove, quick release strap, Thinsulate, Waterproof', 6, 78, 468),
(9, '54147', 'Boys 8-12 Heathered Taslon Ski Glove, quick release strap, Thinsulate, Waterproof', 6, 81, 486),
(10, '57216', 'Boys One Size Chunky Fair Isle Cuff Hat, fleece lining', 1, 36, 36),
(11, '60148', 'Mens One Size Fair Isle Cuff Hat, marled cuff', 2, 36, 72),
(12, '60861', 'Mens One Size Dry Moisture Wicking Microfleece neck gaiter', 6, 22.8, 136.8),
(13, '60890', 'Mens One Size Microfleece 2-in-1 Hood & Neck Warmer', 7, 42, 294),
(14, '847', 'Mens One Size Acrylic Superstretch Cuff Hat, Thinsulate -Asst. colors', 4, 19.2, 76.8),
(15, '20185', 'Boys 13-18 Taslon Promo Thinsulate ski glove, knit cuff, sure-grip palm patch', 3, 48, 144),
(16, '20186', 'Boys 4-7 Taslon Promo Thinsulate ski glove, knit cuff, sure-grip palm patch', 3, 48, 144),
(17, '20187', 'Boys 8-12 Taslon Promo Thinsulate ski glove, knit cuff, sure-grip palm patch', 3, 48, 144),
(18, '33074', 'Mens M-L-XL Realtree Brushed Tricot Camo Glove, gripper dots palm, fleece lining - Xtra', 3, 78, 234),
(19, '37018', 'Tod. 2-4 Girl''s Spacedye Chenille Cuff Hat, Two Faux Fur Poms, Plush lining', 2, 43.2, 86.4),
(20, '37034', 'Boys 2-4 Girl''s Unicorns Cuff Hat, Faux Fur Pom', 2, 48, 96),
(21, '41702', 'Girls 4-6x Hearts cut-out Ski Mitten, Thinsulate, Waterproof', 6, 66, 396),
(22, '44156', 'Girls One Size Sparkle Cable Cuff Hat w pom, Furry Fleece lining', 2, 40.8, 81.6),
(23, '63104', 'Mens M-L-XL Taslon Thinsulate ski glove, velcro strap, knit cuff, grip palm patch', 25, 51, 1275),
(24, '63127', 'Mens M-L-XL Taslon Bec-Tech ski glove, pull strap, Thinsulate, Breathable-Windproof-Waterproof', 6, 87, 522),
(25, '63139', 'Mens M-L-XL Realtree Brushed Tricot Camo Ski Glove Thinsulate, Waterproof - Xtra', 6, 108, 648),
(26, '63350', 'Mens M-L-XL Soft Shell Bec-Tech Snwbrd Glv, Touch,  Pocket, c100, Windproof-Breatable-WP', 9, 126, 1134),
(27, '63360', 'Mens M-L-XL Tusser/Ripstop Bec-Tech Snowboard, Pocket w. zipper, overlock fingers, Thinsulate', 12, 117, 1404),
(28, '63365', 'Mens M-L-XL Soft Shell Bec-Tech Snwbrd Glv, Touch,  Pocket, c100, Windproof-Breatable-WP', 6, 126, 756),
(29, '63631', 'Mens Medium Taslon ski glove, knit cuff, velcro strap, Thinsulate, Waterproof - Black, Size Medium', 12, 66, 792),
(30, '63632', 'Mens Large Taslon ski glove, knit cuff, velcro strap, Thinsulate, Waterproof - Black - Size Large', 7, 66, 462),
(31, '63633', 'Mens XL Taslon ski glove, knit cuff, velcro strap, Thinsulate, Waterproof - Black - Size XL', 6, 66, 396),
(32, '65104', 'Ladies M-L Taslon Thinsulate Ski Glove, knit cuff, palm patch', 16, 51, 816),
(33, '65226', 'Ladies M-L Tusser Snowboard Glove, piping, wrist strap, Thinsulate, Waterproof', 14, 84, 1176),
(34, '71252', 'Ladies M-L Bec-Tech Snowboard Glove, Pocket, Breathable-Windproof-Waterproof, Thinsulate', 6, 114, 684),
(35, '72135', 'Ladies One Size Touch Screen Eyelash Stretch Glove', 4, 16.2, 64.8),
(36, '75015', 'Ladies One Size Farm Animals Beanies, Assorted Animals', 1, 27, 27),
(37, '75033', 'Ladies One Size Twisted Yarn Chevron Cuff Hat, Faux Fur Pom, Sherpa Fleece lining', 1, 54, 54),
(38, '75036', 'Ladies One Size Cable Cuff Hat w. Faux Fur pom, Furry Fleece lining', 3, 51, 153),
(39, '75052', 'Ladies One Size Brushed Ribbed Cuff Hat, Faux Fur Pom', 1, 48, 48),
(40, '75055', 'Ladies One Size Boucle Fair Isle Cuff Hat', 1, 63, 63),
(41, '75173', 'Ladies One Size Plush Boulcle Bow Headband', 1, 28.8, 28.8),
(42, '75174', 'Ladies One Size Twisted Yarn Contoured Knit Headband, Velour Fleece lining', 2, 40.8, 81.6),
(43, '83196', 'Tod. 2-4 Stretch mitten- solids', 5, 6.6, 33),
(44, '87133', 'Tod. 2-4 Boys/GirlsTaslon center velcro ski glove, Thinsulate, Waterproof, grip palm', 6, 63, 378),
(45, '87139', 'Tod. 0-1 Taslon ski mitten, Thinsulate, grip palm patch', 6, 48, 288),
(46, '87154', 'Tod. 2-4 Boy''s/Girl''s Tusser center velcro ski mitten, Thinsulate,grip palm patch', 6, 60, 360),
(47, '87164', 'Girls 7-16 Tusser ski mitten, velcro strap, Thinsulate, Waterproof', 6, 55.2, 331.2),
(48, '87165', 'Girls 4-6x Tusser ski mitten, velcro strap, Thinsulate, Waterproof', 4, 51, 204),
(49, '89092', 'Mens S/M & L/XL Ragwool Glove-mitten, Thinsulate, suede palm and thumb- Marled colors', 3, 93, 279),
(50, '89097', 'Mens M-L-XL Realtree Camo Glove-Mitten, fleece lining - AP HD', 4, 84, 336)
  ) as x(n, vid, d, q, c, e);
  -- the mail about it: Sunny's PO and Dana's final (Feb), the routing company and Becker (Oct)
  update public.emails set order_id = o where order_id is null and subject ilike '%BECKER2926%';
  -- the routing company's two quotes: this order
  update public.freight_quotes set order_id = o, vendor_id = coalesce(vendor_id, '8f4dfd21-50b8-48d6-8b27-45a23fefaade'), match_how = 'po',
         status = case when status = 'needs_order' then 'waiting' else status end
   where id in ('45b561da-cf1b-4654-b4a3-5b85860ab282', 'a76d8f5a-e541-4d44-acdc-65fe65fb782d');
  update public.tasks t set order_id = o, title = public.freight_task_title('BECKER', 'BECKER2926', false, q.ships_by)
    from public.freight_quotes q where q.task_id = t.id and q.id in ('45b561da-cf1b-4654-b4a3-5b85860ab282', 'a76d8f5a-e541-4d44-acdc-65fe65fb782d') and t.done_at is null;
end $$;

-- ---- 2. Manufacturers Exchange is a rep group -----------------------------------------------------------------------
do $$
declare
  me     constant uuid := '877948ec-6edd-4905-a3f5-9dd6d56d6364';
  snd    constant uuid := 'fd80728d-6169-480d-bf22-c8ec80b10d07';
  org    uuid;
  g      uuid;
  lines  uuid[];
  r      record;
  v_to   uuid;
begin
  select organization_id into org from public.vendors where id = me;
  if org is null then return; end if;
  select id into g from public.rep_groups where organization_id = org and lower(name) ~ '^manufacturer.?s exchange$';
  if g is null then
    insert into public.rep_groups (organization_id, name, contact_name, email, phone, website, address, notes)
    values (org, 'Manufacturers Exchange', 'Sunny Lakhani', 'sunny@manxch.com', '212-736-3066', 'manxch.com', '1385 Broadway Ste 1007, New York, NY 10018',
            'Was set up as a vendor until Oct 30, 2026 (Dana). Worldwide lists it as vendor #10053.')
    returning id into g;
  end if;
  insert into public.rep_group_contacts (organization_id, rep_group_id, name, title, email, phone)
  select org, g, x.n, 'Sales Rep', x.e, x.p from (values ('Sunny Lakhani', 'sunny@manxch.com', '917-670-1451'), ('Lance Kessler', 'lance@manxch.com', '917-701-6511')) x(n, e, p)
   where not exists (select 1 from public.rep_group_contacts c where c.rep_group_id = g and lower(c.email) = x.e);
  -- their addresses were saved as the vendor's: moved to the rep group (misfiled contacts are deleted, not kept as former)
  delete from public.vendor_emails where vendor_id = me;

  -- its lines (named in its mail, Sunny's own aliases on two of them)
  update public.vendors set name = 'SILVERSTAR NYC', aliases = array(select distinct x from unnest(aliases || array['MANUFACTURERS EXCH / SILVERSTAR NYC']) x)
   where id = '35c580ae-9e39-4730-917e-0ebebe62d666' and name = 'MANUFACTURERS EXCH / SILVERSTAR NYC';
  select array_agg(id) into lines from public.vendors
   where organization_id = org and id in ('8f4dfd21-50b8-48d6-8b27-45a23fefaade', '7a218cae-8f58-4efd-a650-7e55a2cf5b12', '6a7fff8b-44c9-4856-9db7-1bd40a75f4e2',
                                          '2ad4c46f-f4a1-4163-8aa1-b7cdbdb420a4', '35c580ae-9e39-4730-917e-0ebebe62d666', 'f70462ef-06b9-41be-9368-af939857810c')
      or (organization_id = org and name = 'A-ONE ENTERPRISES');
  update public.vendors set rep_group_id = g where id = any (lines) and rep_group_id is null;

  -- the mail: unfiled from the vendor, then filed again (the sender is the rep group now)
  create temp table manxch_mail on commit drop as select id, thread_id from public.emails where vendor_id = me;
  update public.emails set vendor_id = null, match_how = null where id in (select id from manxch_mail);
  update public.email_threads set vendor_id = null where vendor_id = me;
  delete from public.email_vendor_tags where vendor_id = me;
  perform public.rep_group_file_sender(snd, g, 'Manufacturers Exchange is a rep group (Dana, Oct 30)', null);
  for r in select id from manxch_mail loop perform public.mail_link_email(r.id); end loop;
  for r in select distinct thread_id from manxch_mail loop perform public.mail_refresh_thread(r.thread_id, false); end loop;
  -- replies in a thread that just got its vendor
  for r in select m.id from manxch_mail m join public.emails e on e.id = m.id where e.vendor_id is null loop perform public.mail_link_email(r.id); end loop;
  perform public.rep_group_tag_mail(snd);
  -- Becker's PO emails belong to Becker whatever else they name
  update public.emails set vendor_id = '8f4dfd21-50b8-48d6-8b27-45a23fefaade', match_how = 'thread' where id in (select id from manxch_mail) and subject ilike '%BECKER2926%';
  update public.email_threads set vendor_id = '8f4dfd21-50b8-48d6-8b27-45a23fefaade' where subject ilike '%BECKER2926%' and vendor_id is null;

  -- the files: to the vendor its email is filed to now, else the one line it names, else the rep group
  for r in select l.id, e.vendor_id as ev, e.mentioned_vendor_ids as m from public.vendor_links l left join public.emails e on e.id = l.email_id where l.vendor_id = me loop
    v_to := case when r.ev is not null and r.ev <> me then r.ev end;
    if v_to is null then
      select (array_agg(v.id))[1] into v_to from public.vendors v where v.id = any (coalesce(r.m, '{}')) and v.rep_group_id = g
      having count(*) = 1;
    end if;
    if v_to is not null then
      update public.vendor_links set vendor_id = v_to where id = r.id;
    else
      update public.vendor_links set vendor_id = null, rep_group_id = g where id = r.id;
    end if;
  end loop;
  -- order checks on those papers look again under the right vendor
  update public.order_checks c set vendor_id = l.vendor_id, status = case when c.status in ('needs_order', 'failed') then 'reading' else c.status end, working_at = null
    from public.vendor_links l where l.id = c.document_id and c.vendor_id = me;
  update public.vendors set is_active = false, rep_group_id = g,
         notes = concat_ws(E'\n', nullif(notes, ''), 'A rep group (Manufacturers Exchange), not a vendor (Dana, Oct 30, 2026). Kept only for Worldwide''s vendor list (#10053) and the show listings; its mail and files are on its lines.')
   where id = me;
end $$;

-- ---- 3. quotes we state, and Dana's own inbox --------------------------------------------------------------------
-- Mail the freight quote reader reads: as before, plus mail we send (orders@ and the admin's own inbox) and the mail
-- coming in to the admin's own inbox. direction and private tell the reader what it is.
drop function if exists public.freight_quote_queue(uuid, integer);
create function public.freight_quote_queue(p_org uuid, p_limit integer default 10)
returns table (email_id uuid, thread_id uuid, vendor_id uuid, sender_kind text, from_name text, from_email text, subject text, body_text text,
               received_at timestamptz, attachments text[], direction text, private boolean)
language sql stable security definer set search_path = public as $$
  select e.id, e.thread_id, coalesce(e.vendor_id, s.vendor_id), s.kind, e.from_name, e.from_email, e.subject, left(coalesce(e.body_text, e.snippet, ''), 6000), e.received_at,
         coalesce((select array_agg(a.file_name) from public.email_attachments a where a.email_id = e.id), '{}'),
         e.direction, e.mailbox_id is not null and t.shared_at is null
    from public.emails e
    left join public.email_senders s on s.id = e.sender_id
    left join public.email_threads t on t.id = e.thread_id
   where e.organization_id = p_org and e.copy_of is null and e.freight_scan_at is null
     and e.received_at >= timestamptz '2026-10-14 00:00 America/Los_Angeles'
     and (e.mailbox_id is null or t.shared_at is not null
          or exists (select 1 from public.mailboxes b where b.id = e.mailbox_id and b.kind = 'personal' and b.owner_id = public.org_admin(p_org)))
     and ((e.direction = 'in' and coalesce(s.kind, 'unknown') in ('vendor', 'rep_group', 'carrier', 'platform', 'unknown'))
          or (e.direction = 'out' and public.is_our_address(p_org, e.from_email)))
     and (coalesce(e.subject, '') || ' ' || left(coalesce(e.body_text, e.snippet, ''), 3000))
         ~* '(freight|quote|ready to ship|ready for pick|pick ?up|cartons|pallets?|dimensions|\mdims\M|ship(ping)? (cost|charge)|routing|bill of lading|\mltl\M|\mxpo\M)'
   order by e.received_at
   limit p_limit
$$;
revoke execute on function public.freight_quote_queue(uuid, integer) from public, anon, authenticated;
grant execute on function public.freight_quote_queue(uuid, integer) to service_role;

-- A price we got or chose, stated in our own email: the vendor's open quotes for that order (or that conversation) are
-- approved at our price and their tasks close; without any, one approved quote is kept for the order. Only the carrier
-- and the amount are kept.
create or replace function public.freight_our_choice(p_email uuid, p_carrier text, p_cost numeric, p_vendor uuid, p_order uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  e     public.emails%rowtype;
  v_note text;
  v_id  uuid;
  n     integer := 0;
  q     record;
begin
  select * into e from public.emails where id = p_email;
  if e.id is null then return null; end if;
  update public.emails set freight_scan_at = now() where id = p_email;
  if p_cost is null or p_cost <= 0 then return null; end if;
  if p_order is not null then select coalesce(p_vendor, vendor_id) into p_vendor from public.orders where id = p_order; end if;
  v_note := concat_ws(' ', nullif(trim(coalesce(p_carrier, '')), ''), '$' || to_char(p_cost, 'FM999,990.00'))
            || ': our own price, from our email of ' || to_char(e.received_at at time zone 'America/Los_Angeles', 'Mon FMDD, YYYY');
  for q in select * from public.freight_quotes
            where organization_id = e.organization_id and status in ('needs_order', 'waiting')
              and ((p_order is not null and order_id = p_order) or (e.thread_id is not null and thread_id = e.thread_id)) loop
    update public.freight_quotes set order_id = coalesce(order_id, p_order), vendor_id = coalesce(vendor_id, p_vendor), status = 'approved',
           approved_choice = 'other', approved_cost = p_cost, approved_at = now(), our_note = v_note
     where id = q.id;
    update public.tasks set done_at = now(), done_note = 'VMS saw our price in our email: ' || v_note where id = q.task_id and done_at is null;
    v_id := coalesce(v_id, q.id);
    n := n + 1;
  end loop;
  if n = 0 and not exists (select 1 from public.freight_quotes x where x.status = 'approved' and x.approved_cost = p_cost
                            and ((p_order is not null and x.order_id = p_order) or (e.thread_id is not null and x.thread_id = e.thread_id))) then
    insert into public.freight_quotes (organization_id, vendor_id, order_id, email_id, thread_id, status, match_how, approved_choice, approved_cost, approved_at, our_note)
    values (e.organization_id, p_vendor, p_order, e.id, e.thread_id, 'approved', case when p_order is not null then 'po' end, 'other', p_cost, now(), v_note)
    on conflict (email_id) do nothing
    returning id into v_id;
  end if;
  if p_order is not null then update public.orders set freight_cost = p_cost where id = p_order; end if;
  return v_id;
end;
$$;
revoke execute on function public.freight_our_choice(uuid, text, numeric, uuid, uuid) from public, anon, authenticated;
grant execute on function public.freight_our_choice(uuid, text, numeric, uuid, uuid) to service_role;

-- A vendor's quote (as 0096/0099), and: one that came to the admin's own inbox keeps no text from the email (only the
-- carrier, cost, service, transit and ships-by) and its task is for the inbox's owner, who can open it.
create or replace function public.freight_quote_apply(p_email uuid, p_is_quote boolean, p_reading jsonb, p_vendor uuid, p_order uuid, p_how text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  e      public.emails%rowtype;
  v_id   uuid;
  v_task uuid;
  v_name text;
  v_po   text;
  v_who  uuid;
  v_due  date;
  v_by   text;
  v_priv boolean;
begin
  select * into e from public.emails where id = p_email;
  if e.id is null then return null; end if;
  update public.emails set freight_scan_at = now() where id = p_email;
  if not p_is_quote then return null; end if;
  v_priv := e.mailbox_id is not null and not exists (select 1 from public.email_threads t where t.id = e.thread_id and t.shared_at is not null);
  if p_order is not null then
    select coalesce(p_vendor, vendor_id), po_number into p_vendor, v_po from public.orders where id = p_order;
  end if;
  select name into v_name from public.vendors where id = p_vendor;
  v_by := public.freight_ships_by(p_reading);
  insert into public.freight_quotes (organization_id, vendor_id, order_id, email_id, thread_id, status, match_how,
                                     vendor_carrier, vendor_service, vendor_cost, transit, details, ships_by)
  values (e.organization_id, p_vendor, p_order, e.id, e.thread_id, case when p_order is null then 'needs_order' else 'waiting' end,
          case when p_order is null then null else p_how end,
          nullif(p_reading->>'carrier', ''), nullif(p_reading->>'service', ''),
          case when coalesce(p_reading->>'cost', '') ~ '^[0-9]+(\.[0-9]+)?$' then (p_reading->>'cost')::numeric end,
          nullif(p_reading->>'transit', ''), case when v_priv then '{}'::jsonb else coalesce(p_reading->'details', '{}'::jsonb) end, v_by)
  on conflict (email_id) do nothing
  returning id into v_id;
  if v_id is null then return null; end if;
  if p_order is not null then update public.emails set order_id = coalesce(order_id, p_order) where id = p_email; end if;

  v_who := case when v_priv then (select owner_id from public.mailboxes where id = e.mailbox_id) else public.freight_assignee(e.organization_id) end;
  v_due := public.next_business_day(e.received_at);
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, vendor_id, order_id, thread_id, auto_key)
  values (e.organization_id,
          public.freight_task_title(v_name, v_po, p_order is null, v_by),
          case v_by when 'pallet' then 'Pallet: get a Priority One price, then approve the cheaper one on the freight quote (Freight › Freight quotes).'
                    when 'parcel' then 'Parcel: get a UPS price through WWEX, then approve the cheaper one on the freight quote (Freight › Freight quotes).'
                    else 'Pallet → Priority One; parcel (boxes) → UPS through WWEX. Get that price, then approve the cheaper one (Freight › Freight quotes).' end,
          v_due, (v_due + time '09:00') at time zone 'America/Los_Angeles', v_who, p_vendor, p_order, e.thread_id, 'freight_quote:' || v_id)
  on conflict (organization_id, auto_key) where auto_key is not null do nothing
  returning id into v_task;
  update public.freight_quotes set task_id = v_task where id = v_id;
  return v_id;
end;
$function$;
