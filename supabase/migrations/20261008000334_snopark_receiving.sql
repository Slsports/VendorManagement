-- Sno-Park receiving, packets and the season-end check (Dana, Nov 10, 2026).
-- "I want whoever enters the order to LS to check the books to make sure we received them against this sheet that they
-- send us with the books … VMS knows that we should only be receiving full books so if the numbers don't add up it flags
-- the person entering the items … the system drafts an email to send to them … The employee reviews the draft and sends it
-- with a cc to dana@ … I'd like that [the LS entry] to happen automatically, once they agree we received those and I'd like
-- a dated note in LS under each listing … at the end of the season … a complete check to make sure that LS sold the same
-- amount of passes as we have submitted … If we are off I want a summary emailed to me automatically."
--
-- 1. A shipment (one FedEx box) carries the State's sheet (form OHV 145SP, read by Claude and confirmed by the person), the
--    books entered one row each (book number, first and last permit), the check between the two, and what went to LS.
-- 2. Books have a standard size per kind (day 25, season 10, on the season); a book of another size, a book outside the
--    sheet's ranges, a gap or a count that does not match is a difference. Differences flag the person entering, with a
--    task and an email draft to the State (cc Dana) they send themselves. Nothing goes to LS until it balances, or Dana
--    accepts the box as it is.
-- 3. Balanced: the snopark function makes the LS purchase order, checks it in and adds the dated note line to each item.
-- 4. Reports get a printable copy of the State's form and the packet (form first, then the book-cover photos) filed in
--    "Submitted permit payments" (monthly) or "Season final reports" (final).
-- 5. Season end: LS's sales against everything reported; when off, VMS emails Dana the summary itself (her exception,
--    Nov 10, to "nothing goes out on its own").

-- ---- the main rep at the State (Dana, Nov 10: Monica Perez, "please add to the record as 'main rep'") ------------
do $$ declare v_vendor uuid; v_contact uuid; begin
  select id into v_vendor from public.vendors where upper(name) = 'CA SNOW PARK' and organization_id = '00000000-0000-0000-0000-000000000001' limit 1;
  if v_vendor is null then return; end if;
  select id into v_contact from public.vendor_emails where vendor_id = v_vendor and lower(email) = 'monica.perez@parks.ca.gov' limit 1;
  if v_contact is not null then
    update public.vendor_emails
       set roles = '{rep,customer_service}', contact_type = 'rep', title = 'Analyst I', phone = '(916) 206-0116',
           phones = '[{"number": "(916) 206-0116", "type": "work", "label": null, "ext": null}]'::jsonb,
           notes = 'Our main contact at the OHMVR Division (Dana, Nov 10). Hours M-F 8 AM-4:30 PM. From her email signature.',
           confirmed_at = coalesce(confirmed_at, now())
     where id = v_contact;
    update public.vendors set assigned_rep_contact_id = v_contact where id = v_vendor;
  end if;
  -- the mailing address every report goes to (from the State's forms)
  update public.vendors set address = coalesce(address, 'OHMVR Division, P.O. Box 942896'), city = coalesce(city, 'Sacramento'), state = coalesce(state, 'CA'), postal_code = coalesce(postal_code, '94296')
   where id = v_vendor;
end $$;

-- ---- book sizes and the season-end check --------------------------------------------------------------------------
alter table public.snopark_seasons add column if not exists day_per_book integer not null default 25 check (day_per_book between 1 and 500);
alter table public.snopark_seasons add column if not exists season_per_book integer not null default 10 check (season_per_book between 1 and 500);
alter table public.snopark_seasons add column if not exists ls_check jsonb;
alter table public.snopark_seasons add column if not exists ls_checked_at timestamptz;
comment on column public.snopark_seasons.ls_check is 'Season end: LS sales by kind against everything reported, {day: {ls, reported}, season: {…}, off: bool, emailed_at}.';

alter table public.snopark_reports add column if not exists print_link_id uuid references public.vendor_links(id) on delete set null;
alter table public.snopark_reports add column if not exists packet_link_id uuid references public.vendor_links(id) on delete set null;

-- ---- shipments: one FedEx box, its sheet, its books, its check --------------------------------------------------
create table if not exists public.snopark_shipments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  season_id uuid not null references public.snopark_seasons(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  received_on date not null default current_date,
  received_by uuid references public.profiles(id) on delete set null,
  sheet_link_id uuid references public.vendor_links(id) on delete set null,   -- the State's sheet (OHV 145SP) on file
  sheet jsonb,                                                                  -- what Claude read, then what the person confirmed
  sheet_confirmed_at timestamptz,
  sheet_confirmed_by uuid references public.profiles(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'off', 'balanced', 'done')),
  differences jsonb not null default '[]'::jsonb,
  accepted_note text,                                                           -- Dana accepted the box with differences
  task_id uuid references public.tasks(id) on delete set null,
  draft_id uuid references public.email_drafts(id) on delete set null,
  ls_order_id text,
  ls_done_at timestamptz,
  ls_note text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists snopark_shipments_season on public.snopark_shipments (season_id, received_on desc);
comment on table public.snopark_shipments is 'A box of Sno-Park books received: the State''s sheet, the books entered, the check between them, and the LS entry.';
comment on column public.snopark_shipments.sheet is '{season_label, shipped_on, requested: {day_books, day_permits, season_books, season_permits}, day: {from, to, books, permits}, season: {from, to, books, permits}, unclear: [text]}';
alter table public.snopark_books add column if not exists shipment_id uuid references public.snopark_shipments(id) on delete set null;
create index if not exists snopark_books_shipment on public.snopark_books (shipment_id);

alter table public.snopark_shipments enable row level security;
create policy snopark_shipments_read on public.snopark_shipments for select to authenticated using (public.user_in_org(organization_id));
create policy snopark_shipments_write on public.snopark_shipments for insert to authenticated with check (public.user_in_org(organization_id) and public.user_can_edit());
create policy snopark_shipments_edit on public.snopark_shipments for update to authenticated using (public.user_in_org(organization_id) and public.user_can_edit()) with check (public.user_in_org(organization_id));
grant select, insert, update on public.snopark_shipments to authenticated;
grant all on public.snopark_shipments to service_role;
create trigger snopark_shipments_touch before update on public.snopark_shipments for each row execute function public.set_updated_at();
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'snopark_shipments') then
    alter publication supabase_realtime add table public.snopark_shipments;
  end if;
end $$;

-- the files: the State's sheet, the printable form, the packets
alter table public.vendor_links drop constraint if exists vendor_links_kind_check;
alter table public.vendor_links add constraint vendor_links_kind_check check (kind in ('catalog', 'price_list', 'order_form', 'specials', 'website', 'other', 'invoice', 'credit', 'confirmation', 'order', 'ls_po', 'packing_slip', 'payment', 'freight_bill', 'delivery_receipt', 'image', 'approved_proof', 'damage_photo', 'sales_report', 'proof', 'inventory_count', 'snopark_report', 'snopark_scan', 'snopark_form', 'snopark_sheet', 'snopark_print', 'snopark_packet', 'snopark_final_packet'));

-- ---- start a shipment --------------------------------------------------------------------------------------------
create or replace function public.snopark_shipment_start(p_season uuid, p_received date default current_date, p_order uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.snopark_seasons%rowtype; v_id uuid; v_order uuid := p_order;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers receive books' using errcode = '42501'; end if;
  select * into s from public.snopark_seasons where id = p_season and public.user_in_org(organization_id);
  if s.id is null then raise exception 'Season not found' using errcode = '22023'; end if;
  -- the open order to the State, when there is exactly one
  if v_order is null and s.vendor_id is not null then
    select id into v_order from public.orders where vendor_id = s.vendor_id and status in ('open', 'confirmed', 'shipped') order by order_date desc limit 1;
  end if;
  insert into public.snopark_shipments (organization_id, season_id, order_id, received_on, received_by, created_by)
  values (s.organization_id, p_season, v_order, coalesce(p_received, current_date), auth.uid(), auth.uid()) returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.snopark_shipment_start(uuid, date, uuid) from public, anon;
grant execute on function public.snopark_shipment_start(uuid, date, uuid) to authenticated;

-- The sheet as read (service role, from the snopark function) or as the person confirmed it (authenticated).
create or replace function public.snopark_shipment_sheet(p_shipment uuid, p_sheet jsonb, p_link uuid default null, p_confirmed boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare sh public.snopark_shipments%rowtype;
begin
  select * into sh from public.snopark_shipments where id = p_shipment and (auth.uid() is null or (public.user_in_org(organization_id) and public.user_can_edit()));
  if sh.id is null then raise exception 'Shipment not found' using errcode = '22023'; end if;
  if sh.status = 'done' then raise exception 'These books are already in Lightspeed; the sheet stays as it is' using errcode = '22023'; end if;
  update public.snopark_shipments
     set sheet = coalesce(p_sheet, sheet), sheet_link_id = coalesce(p_link, sheet_link_id),
         sheet_confirmed_at = case when p_confirmed then now() else null end,
         sheet_confirmed_by = case when p_confirmed then auth.uid() else null end
   where id = p_shipment;
end $$;
revoke execute on function public.snopark_shipment_sheet(uuid, jsonb, uuid, boolean) from public, anon;
grant execute on function public.snopark_shipment_sheet(uuid, jsonb, uuid, boolean) to authenticated, service_role;

-- ---- the books in the box, one row each -------------------------------------------------------------------------
-- p_books: [{kind, book_number, first_permit, last_permit}]. Replaces the shipment's books that are still on hand (a book
-- already on a report stays). Refuses a book whose number or permits overlap another book of the season.
create or replace function public.snopark_shipment_books(p_shipment uuid, p_books jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare sh public.snopark_shipments%rowtype; x record; n integer := 0; v_kind text; v_book text;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers enter books' using errcode = '42501'; end if;
  select * into sh from public.snopark_shipments where id = p_shipment and public.user_in_org(organization_id);
  if sh.id is null then raise exception 'Shipment not found' using errcode = '22023'; end if;
  if sh.status = 'done' then raise exception 'These books are already in Lightspeed; they cannot be changed here' using errcode = '22023'; end if;
  delete from public.snopark_books where shipment_id = p_shipment and status = 'on_hand';
  for x in select e->>'kind' as kind, trim(e->>'book_number') as book_number, (e->>'first_permit')::integer as first_permit, (e->>'last_permit')::integer as last_permit
             from jsonb_array_elements(coalesce(p_books, '[]'::jsonb)) e loop
    v_kind := x.kind; v_book := x.book_number;
    if v_kind not in ('day', 'season') then raise exception 'Day or Season' using errcode = '22023'; end if;
    if coalesce(v_book, '') = '' then raise exception 'Every book needs its number from the cover' using errcode = '22023'; end if;
    if x.first_permit is null or x.last_permit is null or x.first_permit < 1 or x.last_permit < x.first_permit then
      raise exception 'Book %: the first and last permit numbers', v_book using errcode = '22023'; end if;
    if exists (select 1 from public.snopark_books b where b.season_id = sh.season_id and b.kind = v_kind and (b.book_number = v_book or (b.first_permit <= x.last_permit and b.last_permit >= x.first_permit))) then
      raise exception 'Book % (permits %-%) is already entered or overlaps a book on file', v_book, x.first_permit, x.last_permit using errcode = '23505';
    end if;
    insert into public.snopark_books (organization_id, season_id, shipment_id, kind, book_number, first_permit, last_permit, order_id, received_on, created_by)
    values (sh.organization_id, sh.season_id, p_shipment, v_kind, v_book, x.first_permit, x.last_permit, sh.order_id, sh.received_on, auth.uid());
    n := n + 1;
  end loop;
  -- the check runs again
  update public.snopark_shipments set status = case when status in ('balanced', 'off') then 'open' else status end, differences = '[]'::jsonb where id = p_shipment;
  return n;
end $$;
revoke execute on function public.snopark_shipment_books(uuid, jsonb) from public, anon;
grant execute on function public.snopark_shipment_books(uuid, jsonb) to authenticated;

-- A book's number or permits corrected while it is on hand (Dana, Nov 10: the ranges "she can correct").
create or replace function public.snopark_book_update(p_book uuid, p_book_number text, p_first integer, p_last integer) returns void
language plpgsql security definer set search_path = public as $$
declare b public.snopark_books%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers change books' using errcode = '42501'; end if;
  select * into b from public.snopark_books where id = p_book and public.user_in_org(organization_id);
  if b.id is null then raise exception 'Book not found' using errcode = '22023'; end if;
  if b.status <> 'on_hand' then raise exception 'Book % is on a report; it cannot be changed', b.book_number using errcode = '22023'; end if;
  if coalesce(trim(p_book_number), '') = '' or p_first is null or p_last is null or p_first < 1 or p_last < p_first then raise exception 'The book number and its first and last permit' using errcode = '22023'; end if;
  if exists (select 1 from public.snopark_books o where o.season_id = b.season_id and o.kind = b.kind and o.id <> b.id and (o.book_number = trim(p_book_number) or (o.first_permit <= p_last and o.last_permit >= p_first))) then
    raise exception 'Book % (permits %-%) overlaps another book on file', trim(p_book_number), p_first, p_last using errcode = '23505';
  end if;
  update public.snopark_books set book_number = trim(p_book_number), first_permit = p_first, last_permit = p_last where id = b.id;
  if b.shipment_id is not null then update public.snopark_shipments set status = case when status in ('balanced', 'off') then 'open' else status end where id = b.shipment_id and status <> 'done'; end if;
end $$;
revoke execute on function public.snopark_book_update(uuid, text, integer, integer) from public, anon;
grant execute on function public.snopark_book_update(uuid, text, integer, integer) to authenticated;

-- ---- the check: the books against the sheet and the standard book size -----------------------------------------
-- Returns the differences, each {kind, text}, and sets the shipment balanced or off. Without a confirmed sheet only the
-- book sizes are checked and the shipment stays open.
create or replace function public.snopark_shipment_check(p_shipment uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sh public.snopark_shipments%rowtype; s public.snopark_seasons%rowtype; out jsonb := '[]'::jsonb; k text; per integer; b record;
        v_from integer; v_to integer; v_books integer; v_permits integer; n_books integer; n_permits integer; lo integer; hi integer; covered integer; label text;
begin
  select * into sh from public.snopark_shipments where id = p_shipment and (auth.uid() is null or public.user_in_org(organization_id));
  if sh.id is null then raise exception 'Shipment not found' using errcode = '22023'; end if;
  select * into s from public.snopark_seasons where id = sh.season_id;
  foreach k in array array['day', 'season'] loop
    per := case when k = 'day' then s.day_per_book else s.season_per_book end;
    label := case when k = 'day' then 'Day' else 'Season' end;
    -- every book is a whole book
    for b in select book_number, first_permit, last_permit from public.snopark_books where shipment_id = p_shipment and kind = k order by first_permit loop
      if b.last_permit - b.first_permit + 1 <> per then
        out := out || jsonb_build_object('kind', k, 'text', format('%s book %s holds %s permits (%s-%s); a %s book holds %s.', label, b.book_number, b.last_permit - b.first_permit + 1, b.first_permit, b.last_permit, lower(label), per));
      end if;
    end loop;
    if sh.sheet_confirmed_at is not null then
      v_from := nullif(sh.sheet->k->>'from', '')::integer; v_to := nullif(sh.sheet->k->>'to', '')::integer;
      v_books := nullif(sh.sheet->k->>'books', '')::integer; v_permits := nullif(sh.sheet->k->>'permits', '')::integer;
      select count(*), coalesce(sum(last_permit - first_permit + 1), 0), min(first_permit), max(last_permit) into n_books, n_permits, lo, hi from public.snopark_books where shipment_id = p_shipment and kind = k;
      if v_from is not null and v_to is not null then
        if v_to - v_from + 1 <> coalesce(v_permits, v_to - v_from + 1) then
          out := out || jsonb_build_object('kind', k, 'text', format('The sheet says %s %s permits from %s to %s, but that range holds %s permits.', v_permits, lower(label), v_from, v_to, v_to - v_from + 1));
        end if;
        if (v_to - v_from + 1) % per <> 0 then
          out := out || jsonb_build_object('kind', k, 'text', format('The sheet''s %s range %s to %s is %s permits, which is not a whole number of books of %s (%s books).', lower(label), v_from, v_to, v_to - v_from + 1, per, round((v_to - v_from + 1)::numeric / per, 1)));
        elsif v_books is not null and (v_to - v_from + 1) / per <> v_books then
          out := out || jsonb_build_object('kind', k, 'text', format('The sheet says %s %s books, but permits %s to %s are %s books of %s.', v_books, lower(label), v_from, v_to, (v_to - v_from + 1) / per, per));
        end if;
        if n_books = 0 then
          out := out || jsonb_build_object('kind', k, 'text', format('The sheet lists %s permits %s to %s; no %s books were entered.', lower(label), v_from, v_to, lower(label)));
        else
          if lo < v_from or hi > v_to then
            out := out || jsonb_build_object('kind', k, 'text', format('%s books entered run %s to %s; the sheet says %s to %s.', label, lo, hi, v_from, v_to));
          end if;
          select coalesce(sum(least(last_permit, v_to) - greatest(first_permit, v_from) + 1), 0) into covered from public.snopark_books where shipment_id = p_shipment and kind = k and first_permit <= v_to and last_permit >= v_from;
          if covered < v_to - v_from + 1 then
            out := out || jsonb_build_object('kind', k, 'text', format('%s permits in the sheet''s %s range (%s to %s) are not in any book entered: a book is missing from the box or not entered yet.', (v_to - v_from + 1) - covered, lower(label), v_from, v_to));
          end if;
        end if;
      elsif n_books > 0 then
        out := out || jsonb_build_object('kind', k, 'text', format('%s %s books were entered but the sheet shows no %s permits.', n_books, lower(label), lower(label)));
      end if;
      if v_books is not null and n_books <> v_books then
        out := out || jsonb_build_object('kind', k, 'text', format('The sheet says %s %s books were issued; %s entered.', v_books, lower(label), n_books));
      end if;
    end if;
  end loop;
  if sh.status <> 'done' then
    update public.snopark_shipments set differences = out,
           status = case when sh.sheet_confirmed_at is null then 'open' when jsonb_array_length(out) = 0 and exists (select 1 from public.snopark_books where shipment_id = p_shipment) then 'balanced' when jsonb_array_length(out) > 0 then 'off' else 'open' end
     where id = p_shipment;
  end if;
  return out;
end $$;
revoke execute on function public.snopark_shipment_check(uuid) from public, anon;
grant execute on function public.snopark_shipment_check(uuid) to authenticated, service_role;

-- ---- off: a task for the person entering and the email draft to the State (cc Dana), which they send -----------
create or replace function public.snopark_shipment_flag(p_shipment uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare sh public.snopark_shipments%rowtype; s public.snopark_seasons%rowtype; v_me uuid := auth.uid(); v_admin uuid; v_admin_email text; v_to text[]; v_body text; v_lines text; v_task uuid; v_draft uuid; v_name text; v_vendor text;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers report a difference' using errcode = '42501'; end if;
  select * into sh from public.snopark_shipments where id = p_shipment and public.user_in_org(organization_id);
  if sh.id is null then raise exception 'Shipment not found' using errcode = '22023'; end if;
  if sh.status <> 'off' then raise exception 'Run the check first; only a box that does not match is reported' using errcode = '22023'; end if;
  select * into s from public.snopark_seasons where id = sh.season_id;
  v_admin := public.org_admin(sh.organization_id);
  select email into v_admin_email from public.profiles where id = v_admin;
  select full_name into v_name from public.profiles where id = v_me;
  select name into v_vendor from public.vendors where id = s.vendor_id;
  -- the State's orders contact, else every current email on the vendor
  select array_agg(distinct lower(email)) into v_to from public.vendor_emails where vendor_id = s.vendor_id and former_at is null and bad_email_at is null and ('orders' = any(roles) or contact_type = 'orders');
  if v_to is null then select array_agg(distinct lower(email)) into v_to from public.vendor_emails where vendor_id = s.vendor_id and former_at is null and bad_email_at is null; end if;
  select string_agg('- ' || (d->>'text'), E'\n') into v_lines from jsonb_array_elements(sh.differences) d;
  v_body := 'Hello,' || E'\n\n' || 'We received our Sno-Park permit books on ' || to_char(sh.received_on, 'FMMonth FMDD, YYYY') || ' and checked them against the Vendor Permit Request Form that came with them. Something does not match:' || E'\n\n'
         || coalesce(v_lines, '') || E'\n\n' || 'Could you look at your records and let us know what we should have? We want every book accounted for before we start selling from this shipment.' || E'\n\n' || 'Thank you,' || E'\n' || coalesce(v_name, '');
  insert into public.email_drafts (organization_id, owner_id, created_by, to_emails, cc_emails, subject, body, vendor_id, order_id, note, vendor_link_ids)
  values (sh.organization_id, v_me, null, coalesce(v_to, '{}'), case when v_admin_email is not null then array[v_admin_email] else '{}' end,
          'Sno-Park permit books received ' || to_char(sh.received_on, 'FMMM/FMDD/YYYY') || ': a difference from the shipment sheet', v_body, s.vendor_id, sh.order_id,
          'Written by VMS from the receiving check on the Sno-Park page. Read it over and press Send; Dana is copied.', case when sh.sheet_link_id is not null then array[sh.sheet_link_id] else '{}' end)
  returning id into v_draft;
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, vendor_id, order_id, draft_id, auto_key, area)
  values (sh.organization_id, 'Sno-Park books: the box does not match the State''s sheet', 'The books entered on ' || to_char(sh.received_on, 'Mon FMDD') || ' do not match the sheet that came with them:' || E'\n' || coalesce(v_lines, '') || E'\n\nLook at the box again, fix any book entered wrong, and send the email VMS drafted to the State (Dana is copied). Nothing goes into Lightspeed until it balances or Dana accepts the box.',
          current_date + 2, now(), v_me, v_me, s.vendor_id, sh.order_id, v_draft, 'snopark_ship:' || sh.id, 'general')
  on conflict (organization_id, auto_key) where auto_key is not null do update set notes = excluded.notes, draft_id = excluded.draft_id, done_at = null, done_note = null, closed_how = null
  returning id into v_task;
  update public.snopark_shipments set task_id = v_task, draft_id = v_draft where id = sh.id;
  return v_task;
end $$;
revoke execute on function public.snopark_shipment_flag(uuid) from public, anon;
grant execute on function public.snopark_shipment_flag(uuid) to authenticated;

-- Dana accepts a box that does not match (the State answered, or she knows why): it can go to Lightspeed as entered.
create or replace function public.snopark_shipment_accept(p_shipment uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare sh public.snopark_shipments%rowtype;
begin
  if not public.is_admin() then raise exception 'Only the administrator accepts a box that does not match the sheet' using errcode = '42501'; end if;
  select * into sh from public.snopark_shipments where id = p_shipment and public.user_in_org(organization_id);
  if sh.id is null then raise exception 'Shipment not found' using errcode = '22023'; end if;
  if sh.status <> 'off' then raise exception 'Only a box that does not match is accepted this way' using errcode = '22023'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'Say why the box is accepted as it is' using errcode = '22023'; end if;
  update public.snopark_shipments set status = 'balanced', accepted_note = trim(p_note) where id = sh.id;
end $$;
revoke execute on function public.snopark_shipment_accept(uuid, text) from public, anon;
grant execute on function public.snopark_shipment_accept(uuid, text) to authenticated;

-- ---- done: the LS purchase order is in (service role, from the snopark function) --------------------------------
create or replace function public.snopark_shipment_done(p_shipment uuid, p_ls_order text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare sh public.snopark_shipments%rowtype;
begin
  select * into sh from public.snopark_shipments where id = p_shipment;
  if sh.id is null then return; end if;
  update public.snopark_shipments set status = 'done', ls_order_id = p_ls_order, ls_done_at = now(), ls_note = p_note where id = sh.id;
  if sh.order_id is not null then
    update public.orders set status = 'received', date_received = coalesce(date_received, sh.received_on), date_entered_ls = coalesce(date_entered_ls, current_date), ls_order_id = coalesce(ls_order_id, p_ls_order) where id = sh.order_id;
  end if;
  update public.tasks set done_at = now(), closed_how = 'vms', remind_at = null,
         done_note = 'The box balanced against the State''s sheet' || case when sh.accepted_note is not null then ' (accepted by Dana: ' || sh.accepted_note || ')' else '' end || ' and the books went into Lightspeed as PO ' || coalesce(p_ls_order, '') || '.'
   where id = sh.task_id and done_at is null;
end $$;
revoke execute on function public.snopark_shipment_done(uuid, text, text) from public, anon, authenticated;
grant execute on function public.snopark_shipment_done(uuid, text, text) to service_role;

-- ---- season end: LS against everything reported ------------------------------------------------------------------
create or replace function public.snopark_season_compare(p_season uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s public.snopark_seasons%rowtype; ls_day integer := 0; ls_season integer := 0; rep_day integer := 0; rep_season integer := 0; r record;
begin
  select * into s from public.snopark_seasons where id = p_season and (auth.uid() is null or public.user_in_org(organization_id));
  if s.id is null then raise exception 'Season not found' using errcode = '22023'; end if;
  for r in
    select case when i.description ~* 'season' then 'season' else 'day' end as kind, coalesce(sum(l.qty), 0)::integer as qty
      from public.ls_items i
      join public.ls_sale_lines l on l.item_id = i.item_id and l.organization_id = s.organization_id
       and l.sold_at >= make_timestamptz(substr(s.label, 1, 4)::integer, 10, 1, 0, 0, 0, 'America/Los_Angeles')
       and l.sold_at < (s.season_end + 1)::timestamp at time zone 'America/Los_Angeles'
     where i.organization_id = s.organization_id and i.description ~* 'sno[w -]*park' and i.description ~* 'permit'
     group by 1
  loop
    if r.kind = 'day' then ls_day := r.qty; else ls_season := r.qty; end if;
  end loop;
  select coalesce(sum(case when x.kind = 'day' then x.qty else 0 end), 0), coalesce(sum(case when x.kind = 'season' then x.qty else 0 end), 0) into rep_day, rep_season
    from public.snopark_report_rows x join public.snopark_reports rp on rp.id = x.report_id where rp.season_id = p_season and x.section = 'sold';
  return jsonb_build_object(
    'day', jsonb_build_object('ls', ls_day, 'reported', rep_day),
    'season', jsonb_build_object('ls', ls_season, 'reported', rep_season),
    'off', (ls_day <> rep_day or ls_season <> rep_season),
    'through', s.season_end);
end $$;
revoke execute on function public.snopark_season_compare(uuid) from public, anon;
grant execute on function public.snopark_season_compare(uuid) to authenticated, service_role;

-- The task that flags a box opens the receiving page; its link kind is snopark_ship:<shipment>.

-- ---- the daily season-end check (the snopark function, x-cron-secret): closed seasons not checked yet ----------------
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'snopark-season-check';
    perform cron.schedule('snopark-season-check', '45 14 * * *',
      $job$select net.http_post(url := 'https://bpdpkytfmpbwpbmpejbf.supabase.co/functions/v1/snopark', headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mail_cron_secret')), body := '{}'::jsonb, timeout_milliseconds := 150000)$job$);
  end if;
end $$;
