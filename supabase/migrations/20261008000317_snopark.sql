-- Sno-Park passes (Dana, Nov 5-6, 2026). CA Sno-Park (the State of California, OHMVR Division) is a pay-for-what-you-sold
-- vendor: we email an order for books of permits, they FedEx them, the books are entered here with the permit numbers
-- inside each one; every month in season Cat picks the books that are empty, VMS fills the State's Excel report (form OHV
-- 54SP), works out the check, and Cat mails the report, the check and the empty books; at season end the final report lists
-- every book, sold or not, and the unsold go back. Nothing is emailed monthly. The season opens when the State's vendor
-- packet email arrives. First report of a season is for November, due December 15; final due June 20.

create table public.snopark_seasons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  vendor_id uuid references public.vendors(id) on delete set null,
  label text not null,                                   -- "2026-2027"
  opened_email_id uuid references public.emails(id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  first_report_month date not null,                      -- the first month reported (Nov 1): its report is due Dec 15
  season_end date not null,                              -- May 30
  final_due date not null,                               -- June 20
  owner_email text not null default 'cat@shaverlakesports.com',
  day_price numeric(8,2) not null default 15.00,
  day_commission numeric(8,2) not null default 1.80,
  season_price numeric(8,2) not null default 40.00,
  season_commission numeric(8,2) not null default 2.40,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, label)
);

create table public.snopark_books (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  season_id uuid not null references public.snopark_seasons(id) on delete cascade,
  kind text not null check (kind in ('day', 'season')),
  book_number text not null,
  first_permit integer not null,
  last_permit integer not null check (last_permit >= first_permit),
  order_id uuid references public.orders(id) on delete set null,
  received_on date,
  status text not null default 'on_hand' check (status in ('on_hand', 'empty', 'returned')),
  report_id uuid,                                        -- the report that listed it (set below, after snopark_reports)
  returned_on date,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_id, kind, book_number)
);
create index snopark_books_season on public.snopark_books (season_id, kind, first_permit);

create table public.snopark_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  season_id uuid not null references public.snopark_seasons(id) on delete cascade,
  kind text not null check (kind in ('monthly', 'final')),
  month date not null,                                   -- the month reported (first day); the final carries the season's last month
  seq integer not null,                                  -- 01, 02 … in the file name
  due_on date not null,
  status text not null default 'open' check (status in ('open', 'ready', 'mailed')),
  task_id uuid references public.tasks(id) on delete set null,
  check_task_id uuid references public.tasks(id) on delete set null,
  file_link_id uuid references public.vendor_links(id) on delete set null,
  scan_link_ids uuid[] not null default '{}',
  day_qty integer not null default 0,
  day_amount numeric(10,2) not null default 0,
  day_commission numeric(10,2) not null default 0,
  day_due numeric(10,2) not null default 0,
  season_qty integer not null default 0,
  season_amount numeric(10,2) not null default 0,
  season_commission numeric(10,2) not null default 0,
  season_due numeric(10,2) not null default 0,
  total_due numeric(10,2) not null default 0,
  built_at timestamptz,
  mailed_on date,
  mailed_by uuid references public.profiles(id) on delete set null,
  tracking text,
  declared_by text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_id, kind, month)
);
alter table public.snopark_books add constraint snopark_books_report_id_fkey foreign key (report_id) references public.snopark_reports(id) on delete set null;

create table public.snopark_report_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  report_id uuid not null references public.snopark_reports(id) on delete cascade,
  book_id uuid references public.snopark_books(id) on delete set null,
  section text not null check (section in ('sold', 'unsold')),
  kind text not null check (kind in ('day', 'season')),
  book_number text,
  from_permit integer not null,
  to_permit integer not null check (to_permit >= from_permit),
  qty integer not null,
  amount numeric(10,2) not null default 0,
  commission numeric(10,2) not null default 0,
  due numeric(10,2) not null default 0,
  sort integer not null default 0
);
create index snopark_report_rows_report on public.snopark_report_rows (report_id, section, kind, sort);

-- files: the report and the scans of sold passes, in a Sno-Park folder on the vendor
alter table public.vendor_links drop constraint if exists vendor_links_kind_check;
alter table public.vendor_links add constraint vendor_links_kind_check check (kind in ('catalog', 'price_list', 'order_form', 'specials', 'website', 'other', 'invoice', 'credit', 'confirmation', 'order', 'ls_po', 'packing_slip', 'payment', 'freight_bill', 'delivery_receipt', 'image', 'approved_proof', 'damage_photo', 'sales_report', 'proof', 'inventory_count', 'snopark_report', 'snopark_scan'));

-- ---- access ------------------------------------------------------------------------------------------------------
alter table public.snopark_seasons enable row level security;
alter table public.snopark_books enable row level security;
alter table public.snopark_reports enable row level security;
alter table public.snopark_report_rows enable row level security;
create policy snopark_seasons_read on public.snopark_seasons for select to authenticated using (public.user_in_org(organization_id));
create policy snopark_seasons_edit on public.snopark_seasons for update to authenticated using (public.user_in_org(organization_id) and public.user_can_edit()) with check (public.user_in_org(organization_id));
create policy snopark_books_read on public.snopark_books for select to authenticated using (public.user_in_org(organization_id));
create policy snopark_books_write on public.snopark_books for insert to authenticated with check (public.user_in_org(organization_id) and public.user_can_edit());
create policy snopark_books_edit on public.snopark_books for update to authenticated using (public.user_in_org(organization_id) and public.user_can_edit()) with check (public.user_in_org(organization_id));
create policy snopark_books_delete on public.snopark_books for delete to authenticated using (public.user_in_org(organization_id) and public.user_can_edit());
create policy snopark_reports_read on public.snopark_reports for select to authenticated using (public.user_in_org(organization_id));
create policy snopark_reports_edit on public.snopark_reports for update to authenticated using (public.user_in_org(organization_id) and public.user_can_edit()) with check (public.user_in_org(organization_id));
create policy snopark_report_rows_read on public.snopark_report_rows for select to authenticated using (public.user_in_org(organization_id));
grant select, update on public.snopark_seasons to authenticated;
grant select, insert, update, delete on public.snopark_books to authenticated;
grant select, update on public.snopark_reports to authenticated;
grant select on public.snopark_report_rows to authenticated;
grant all on public.snopark_seasons, public.snopark_books, public.snopark_reports, public.snopark_report_rows to service_role;
create trigger snopark_seasons_touch before update on public.snopark_seasons for each row execute function public.set_updated_at();
create trigger snopark_books_touch before update on public.snopark_books for each row execute function public.set_updated_at();
create trigger snopark_reports_touch before update on public.snopark_reports for each row execute function public.set_updated_at();
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'snopark_books') then alter publication supabase_realtime add table public.snopark_books; end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'snopark_reports') then alter publication supabase_realtime add table public.snopark_reports; end if;
  end if;
end $$;

-- ---- who runs it -----------------------------------------------------------------------------------------------
-- Cat once she has a login (the season's owner_email), else Dana.
create or replace function public.snopark_owner(p_season uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.id from public.snopark_seasons s join public.profiles p on p.organization_id = s.organization_id and lower(p.email) = lower(s.owner_email) and p.is_active where s.id = p_season limit 1),
    (select public.org_admin(organization_id) from public.snopark_seasons where id = p_season))
$$;

create or replace function public.snopark_vendor(p_org uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.vendors where organization_id = p_org and is_active and merged_into_id is null
   and (upper(name) in ('CA SNOW PARK', 'CA SNO-PARK', 'CA SNO PARK') or upper(name) like '%SNO%PARK%') order by name limit 1
$$;

-- ---- the season opens when the State's vendor packet email arrives ------------------------------------------------
create or replace function public.snopark_season_open(p_org uuid, p_label text, p_email uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_season uuid; v_year integer; v_vendor uuid; v_admin uuid; v_thread uuid; v_task uuid;
begin
  select id into v_season from public.snopark_seasons where organization_id = p_org and label = p_label;
  if v_season is not null then return v_season; end if;
  v_year := substr(p_label, 1, 4)::integer;
  v_vendor := public.snopark_vendor(p_org);
  insert into public.snopark_seasons (organization_id, vendor_id, label, opened_email_id, first_report_month, season_end, final_due)
  values (p_org, v_vendor, p_label, p_email, make_date(v_year, 11, 1), make_date(v_year + 1, 5, 30), make_date(v_year + 1, 6, 20))
  returning id into v_season;
  -- Dana returns the packet with the first order (she fills in the State's forms; only she emails them)
  v_admin := public.org_admin(p_org);
  if v_admin is not null then
    select thread_id into v_thread from public.emails where id = p_email;
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, vendor_id, thread_id, auto_key, area)
    values (p_org, left('Sno-Park ' || p_label || ': return the vendor packet with the first order', 200),
            'The State emailed this season''s vendor packet. Fill in the agreement form (OHV 56SP) with a copy of the business license and the permit request form (OHV 145SP), and email them to ohmvr.permits@parks.ca.gov. The books come by FedEx in 5-10 business days; enter them on the Sno-Park page when they arrive.',
            current_date + 14, now() + interval '7 days', v_admin, v_admin, v_vendor, v_thread, 'snopark_packet:' || v_season, 'general')
    on conflict (organization_id, auto_key) where auto_key is not null do nothing
    returning id into v_task;
  end if;
  return v_season;
end $$;
revoke execute on function public.snopark_season_open(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.snopark_season_open(uuid, text, uuid) to service_role;

-- Admin opens a season by hand (when the packet came another way)
create or replace function public.snopark_season_open_by_hand(p_label text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  if not public.is_admin() then raise exception 'Only the administrator opens a season' using errcode = '42501'; end if;
  if p_label !~ '^\d{4}-\d{4}$' then raise exception 'The season is written like 2026-2027' using errcode = '22023'; end if;
  select organization_id into v_org from public.profiles where id = auth.uid();
  return public.snopark_season_open(v_org, p_label, null);
end $$;
revoke execute on function public.snopark_season_open_by_hand(text) from public, anon;
grant execute on function public.snopark_season_open_by_hand(text) to authenticated;

create or replace function public.emails_snopark_season() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_label text;
begin
  if new.direction <> 'in' or new.copy_of is not null then return new; end if;
  if coalesce(new.from_email, '') !~* '@parks\.ca\.gov$' then return new; end if;
  if coalesce(new.subject, '') !~* 'vendor registration' or coalesce(new.subject, '') ~* '^\s*(re|fwd?)\s*:' then return new; end if;
  v_label := substring(new.subject from '(\d{4}-\d{4})');
  if v_label is null then return new; end if;
  perform public.snopark_season_open(new.organization_id, v_label, new.id);
  return new;
end $$;
drop trigger if exists emails_snopark_season on public.emails;
create trigger emails_snopark_season after insert on public.emails for each row execute function public.emails_snopark_season();

-- our reply in the packet's conversation closes the packet task
create or replace function public.emails_snopark_packet_sent() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.direction <> 'out' or new.thread_id is null then return new; end if;
  update public.tasks set done_at = now(), closed_how = 'vms', remind_at = null,
         done_note = 'An email went out in the State''s vendor registration conversation on ' || to_char(new.received_at at time zone 'America/Los_Angeles', 'Mon FMDD, YYYY') || '; VMS took that as the packet going back.',
         done_email_id = new.id
   where thread_id = new.thread_id and auto_key like 'snopark_packet:%' and done_at is null;
  return new;
end $$;
drop trigger if exists emails_snopark_packet_sent on public.emails;
create trigger emails_snopark_packet_sent after insert on public.emails for each row execute function public.emails_snopark_packet_sent();

-- ---- books -------------------------------------------------------------------------------------------------------
-- Books arrive numbered (B450, B451 …) with sequential permits inside. Enter the first book and how many, VMS numbers the rest.
create or replace function public.snopark_books_add(p_season uuid, p_kind text, p_first_book text, p_books integer, p_per_book integer, p_first_permit integer, p_received date default current_date, p_order uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare s public.snopark_seasons%rowtype; v_prefix text; v_num integer; v_width integer; i integer; v_book text; v_from integer;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers enter books' using errcode = '42501'; end if;
  select * into s from public.snopark_seasons where id = p_season and public.user_in_org(organization_id);
  if s.id is null then raise exception 'Season not found' using errcode = '22023'; end if;
  if p_kind not in ('day', 'season') then raise exception 'Day or Season' using errcode = '22023'; end if;
  if p_books is null or p_books < 1 or p_books > 500 then raise exception 'How many books: 1 to 500' using errcode = '22023'; end if;
  if p_per_book is null or p_per_book < 1 or p_per_book > 500 then raise exception 'Permits per book: 1 to 500' using errcode = '22023'; end if;
  if p_first_permit is null or p_first_permit < 1 then raise exception 'The first permit number' using errcode = '22023'; end if;
  v_prefix := coalesce(substring(trim(p_first_book) from '^(.*?)(\d+)$'), '');
  v_num := substring(trim(p_first_book) from '(\d+)$')::integer;
  if v_num is null then raise exception 'The book number ends in digits (B450)' using errcode = '22023'; end if;
  v_width := length(substring(trim(p_first_book) from '(\d+)$'));
  for i in 0 .. p_books - 1 loop
    v_book := v_prefix || lpad((v_num + i)::text, v_width, '0');
    v_from := p_first_permit + i * p_per_book;
    if exists (select 1 from public.snopark_books b where b.season_id = p_season and b.kind = p_kind and (b.book_number = v_book or (b.first_permit <= v_from + p_per_book - 1 and b.last_permit >= v_from))) then
      raise exception 'Book % (permits %-%) is already entered or overlaps a book on file', v_book, v_from, v_from + p_per_book - 1 using errcode = '23505';
    end if;
    insert into public.snopark_books (organization_id, season_id, kind, book_number, first_permit, last_permit, order_id, received_on, created_by)
    values (s.organization_id, p_season, p_kind, v_book, v_from, v_from + p_per_book - 1, p_order, p_received, auth.uid());
  end loop;
  return p_books;
end $$;
revoke execute on function public.snopark_books_add(uuid, text, text, integer, integer, integer, date, uuid) from public, anon;
grant execute on function public.snopark_books_add(uuid, text, text, integer, integer, integer, date, uuid) to authenticated;

-- ---- the monthly and final reports and their tasks (daily cron) --------------------------------------------------
create or replace function public.snopark_report_ensure(p_season uuid, p_kind text, p_month date) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.snopark_seasons%rowtype; v_rep uuid; v_due date; v_seq integer; v_owner uuid; v_title text; v_notes text; v_task uuid;
begin
  select * into s from public.snopark_seasons where id = p_season;
  select id into v_rep from public.snopark_reports where season_id = p_season and kind = p_kind and month = p_month;
  if v_rep is not null then return v_rep; end if;
  v_due := case when p_kind = 'final' then s.final_due else (p_month + interval '1 month')::date + 14 end;
  select coalesce(max(seq), 0) + 1 into v_seq from public.snopark_reports where season_id = p_season;
  insert into public.snopark_reports (organization_id, season_id, kind, month, seq, due_on)
  values (s.organization_id, p_season, p_kind, p_month, v_seq, v_due) returning id into v_rep;
  v_owner := public.snopark_owner(p_season);
  if v_owner is not null then
    v_title := case when p_kind = 'final' then 'Sno-Park ' || s.label || ': final report, payment and the books going back'
                    else 'Sno-Park report for ' || to_char(p_month, 'FMMonth YYYY') end;
    v_notes := case when p_kind = 'final'
      then 'Season end. Every book goes back: tick the empty ones, give the last permit sold in any partly sold book, and VMS fills the State''s final report with the sold ranges and the unsold permits, works out the check, and files it. Mail the report, the check and all the books to OHMVR Division, P.O. Box 942896, Sacramento, CA 94296 by ' || to_char(v_due, 'Mon FMDD') || '.'
      else 'Due the 15th. Tick the books that are empty (every permit sold), upload the scan of the sold passes, and VMS fills the State''s Excel report and works out the check. Mail the report, the check and the empty books to OHMVR Division, P.O. Box 942896, Sacramento, CA 94296. Partly sold books stay with us until they are empty.' end;
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, vendor_id, auto_key, area)
    values (s.organization_id, left(v_title, 200), v_notes, v_due, ((v_due - 5)::text || ' 09:00')::timestamp at time zone 'America/Los_Angeles', v_owner, v_owner, s.vendor_id, 'snopark:' || v_rep, 'general')
    on conflict (organization_id, auto_key) where auto_key is not null do nothing returning id into v_task;
    update public.snopark_reports set task_id = v_task where id = v_rep;
  end if;
  return v_rep;
end $$;
revoke execute on function public.snopark_report_ensure(uuid, text, date) from public, anon, authenticated;
grant execute on function public.snopark_report_ensure(uuid, text, date) to service_role;

-- Every month that has ended since the first report month gets its report; the final once the season has ended.
create or replace function public.snopark_month_tasks() returns integer
language plpgsql security definer set search_path = public as $$
declare s record; m date; n integer := 0; v_today date := (now() at time zone 'America/Los_Angeles')::date;
begin
  for s in select * from public.snopark_seasons where status = 'open' loop
    m := s.first_report_month;
    while m < date_trunc('month', v_today)::date and m <= date_trunc('month', s.season_end)::date loop
      if not exists (select 1 from public.snopark_reports r where r.season_id = s.id and r.kind = 'monthly' and r.month = m) then
        perform public.snopark_report_ensure(s.id, 'monthly', m); n := n + 1;
      end if;
      m := (m + interval '1 month')::date;
    end loop;
    if v_today > s.season_end and not exists (select 1 from public.snopark_reports r where r.season_id = s.id and r.kind = 'final') then
      perform public.snopark_report_ensure(s.id, 'final', date_trunc('month', s.season_end)::date); n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function public.snopark_month_tasks() from public, anon, authenticated;
grant execute on function public.snopark_month_tasks() to service_role;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'snopark-month-tasks';
    perform cron.schedule('snopark-month-tasks', '15 14 * * *', $job$select public.snopark_month_tasks()$job$);   -- 6:15 / 7:15 am Pacific
  end if;
end $$;

-- ---- building a report: the books Cat picks become the rows ----------------------------------------------------
-- p_sold: [{"book_id": …, "to_permit": …}] — to_permit is the last permit sold (the book's last permit when it is empty;
-- less only on the final report, where a partly sold book goes back too). Books left out: untouched on a monthly report;
-- on the final they are listed unsold. Can be run again until the report is mailed.
create or replace function public.snopark_report_build(p_report uuid, p_sold jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r public.snopark_reports%rowtype; s public.snopark_seasons%rowtype; b public.snopark_books%rowtype; x record; v_to integer; v_qty integer;
        v_price numeric; v_comm numeric; v_sort integer := 0; dq integer := 0; da numeric := 0; dc numeric := 0; sq integer := 0; sa numeric := 0; sc numeric := 0;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers build the report' using errcode = '42501'; end if;
  select * into r from public.snopark_reports where id = p_report and public.user_in_org(organization_id);
  if r.id is null then raise exception 'Report not found' using errcode = '22023'; end if;
  if r.status = 'mailed' then raise exception 'This report was mailed; it cannot be changed' using errcode = '22023'; end if;
  select * into s from public.snopark_seasons where id = r.season_id;
  -- start over: books this report had marked go back to on hand
  update public.snopark_books set status = 'on_hand', report_id = null where report_id = p_report and status = 'empty';
  delete from public.snopark_report_rows where report_id = p_report;
  for x in select (e->>'book_id')::uuid as book_id, (e->>'to_permit')::integer as to_permit from jsonb_array_elements(coalesce(p_sold, '[]'::jsonb)) e loop
    select * into b from public.snopark_books where id = x.book_id and season_id = r.season_id and status = 'on_hand';
    if b.id is null then raise exception 'A book picked is not on hand any more' using errcode = '22023'; end if;
    v_to := coalesce(x.to_permit, b.last_permit);
    if v_to < b.first_permit or v_to > b.last_permit then raise exception 'Book %: the last permit sold must be between % and %', b.book_number, b.first_permit, b.last_permit using errcode = '22023'; end if;
    if r.kind = 'monthly' and v_to <> b.last_permit then raise exception 'Book %: only empty books go on a monthly report (partly sold books are accepted at season end)', b.book_number using errcode = '22023'; end if;
    v_qty := v_to - b.first_permit + 1;
    v_price := case when b.kind = 'day' then s.day_price else s.season_price end;
    v_comm := case when b.kind = 'day' then s.day_commission else s.season_commission end;
    v_sort := v_sort + 1;
    insert into public.snopark_report_rows (organization_id, report_id, book_id, section, kind, book_number, from_permit, to_permit, qty, amount, commission, due, sort)
    values (r.organization_id, p_report, b.id, 'sold', b.kind, b.book_number, b.first_permit, v_to, v_qty, v_qty * v_price, v_qty * v_comm, v_qty * (v_price - v_comm), v_sort);
    if b.kind = 'day' then dq := dq + v_qty; da := da + v_qty * v_price; dc := dc + v_qty * v_comm; else sq := sq + v_qty; sa := sa + v_qty * v_price; sc := sc + v_qty * v_comm; end if;
    update public.snopark_books set status = 'empty', report_id = p_report where id = b.id;
    if v_to < b.last_permit then
      v_sort := v_sort + 1;
      insert into public.snopark_report_rows (organization_id, report_id, book_id, section, kind, book_number, from_permit, to_permit, qty, sort)
      values (r.organization_id, p_report, b.id, 'unsold', b.kind, b.book_number, v_to + 1, b.last_permit, b.last_permit - v_to, v_sort);
    end if;
  end loop;
  if r.kind = 'final' then
    for b in select * from public.snopark_books where season_id = r.season_id and status = 'on_hand' order by kind, first_permit loop
      v_sort := v_sort + 1;
      insert into public.snopark_report_rows (organization_id, report_id, book_id, section, kind, book_number, from_permit, to_permit, qty, sort)
      values (r.organization_id, p_report, b.id, 'unsold', b.kind, b.book_number, b.first_permit, b.last_permit, b.last_permit - b.first_permit + 1, v_sort);
      update public.snopark_books set status = 'empty', report_id = p_report where id = b.id;   -- goes back with this report
    end loop;
  end if;
  update public.snopark_reports set day_qty = dq, day_amount = da, day_commission = dc, day_due = da - dc,
         season_qty = sq, season_amount = sa, season_commission = sc, season_due = sa - sc, total_due = (da - dc) + (sa - sc),
         built_at = now(), status = 'open', file_link_id = null
   where id = p_report;
end $$;
revoke execute on function public.snopark_report_build(uuid, jsonb) from public, anon;
grant execute on function public.snopark_report_build(uuid, jsonb) to authenticated;

-- The Excel is made (by the snopark function): the report is ready, and Dana gets the check task.
create or replace function public.snopark_report_ready(p_report uuid, p_link uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.snopark_reports%rowtype; s public.snopark_seasons%rowtype; v_admin uuid; v_task uuid; v_owner text;
begin
  select * into r from public.snopark_reports where id = p_report;
  if r.id is null then return; end if;
  select * into s from public.snopark_seasons where id = r.season_id;
  update public.snopark_reports set file_link_id = p_link, status = 'ready' where id = p_report;
  v_admin := public.org_admin(r.organization_id);
  if v_admin is not null and r.check_task_id is null then
    select full_name into v_owner from public.profiles where id = public.snopark_owner(r.season_id);
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, vendor_id, auto_key, area)
    values (r.organization_id, left('Sno-Park check for $' || to_char(r.total_due, 'FM999,990.00') || ' (' || case when r.kind = 'final' then 'final report' else to_char(r.month, 'FMMonth') || ' report' end || ')', 200),
            'Write the check to the State of California for the permits sold on ' || coalesce(v_owner, 'Cat') || '''s report, due ' || to_char(r.due_on, 'Mon FMDD') || '. It goes in the envelope with the report and the books. This closes when the report is marked Mailed.',
            r.due_on, now(), v_admin, v_admin, s.vendor_id, 'snopark_check:' || r.id, 'general')
    on conflict (organization_id, auto_key) where auto_key is not null do nothing returning id into v_task;
    update public.snopark_reports set check_task_id = v_task where id = p_report and v_task is not null;
  end if;
end $$;
revoke execute on function public.snopark_report_ready(uuid, uuid) from public, anon, authenticated;
grant execute on function public.snopark_report_ready(uuid, uuid) to service_role;

-- Mailed: the books in the envelope are returned, both tasks close, the final closes the season.
create or replace function public.snopark_report_mailed(p_report uuid, p_on date, p_tracking text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r public.snopark_reports%rowtype; v_me uuid := auth.uid(); v_books integer;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers mark a report mailed' using errcode = '42501'; end if;
  select * into r from public.snopark_reports where id = p_report and public.user_in_org(organization_id);
  if r.id is null then raise exception 'Report not found' using errcode = '22023'; end if;
  if r.status = 'mailed' then return; end if;
  if r.built_at is null then raise exception 'Build the report first' using errcode = '22023'; end if;
  update public.snopark_books set status = 'returned', returned_on = coalesce(p_on, current_date) where report_id = p_report and status = 'empty';
  get diagnostics v_books = row_count;
  update public.snopark_reports set status = 'mailed', mailed_on = coalesce(p_on, current_date), mailed_by = v_me, tracking = nullif(trim(p_tracking), '') where id = p_report;
  update public.tasks set done_at = now(), done_by = v_me, closed_how = 'person', remind_at = null,
         done_note = 'Mailed ' || to_char(coalesce(p_on, current_date), 'Mon FMDD, YYYY') || ' with the check for $' || to_char(r.total_due, 'FM999,990.00') || ' and ' || v_books || ' book' || case when v_books = 1 then '' else 's' end
                     || case when nullif(trim(p_tracking), '') is not null then ' (tracking ' || trim(p_tracking) || ')' else '' end || '.'
   where id in (r.task_id, r.check_task_id) and done_at is null;
  if r.kind = 'final' then update public.snopark_seasons set status = 'closed', closed_at = now() where id = r.season_id; end if;
end $$;
revoke execute on function public.snopark_report_mailed(uuid, date, text) from public, anon;
grant execute on function public.snopark_report_mailed(uuid, date, text) to authenticated;

-- ---- the check against Lightspeed ------------------------------------------------------------------------------
-- Permits sold in LS this season (SLS, the only store that sells them), by kind, up to a date: a sanity check next to
-- what the books say, never the source of the numbers.
create or replace function public.snopark_ls_sold(p_season uuid, p_through date default current_date) returns table (kind text, qty integer)
language sql stable security definer set search_path = public as $$
  select case when i.description ~* 'season' then 'season' else 'day' end as kind, coalesce(sum(l.qty), 0)::integer as qty
    from public.snopark_seasons s
    join public.ls_items i on i.organization_id = s.organization_id and i.description ~* 'sno[w -]*park' and i.description ~* 'permit'
    join public.ls_sale_lines l on l.item_id = i.item_id and l.organization_id = s.organization_id
     and l.sold_at >= make_timestamptz(substr(s.label, 1, 4)::integer, 10, 1, 0, 0, 0, 'America/Los_Angeles')
     and l.sold_at < (p_through + 1)::timestamp at time zone 'America/Los_Angeles'
   where s.id = p_season and public.user_in_org(s.organization_id)
   group by 1
$$;
revoke execute on function public.snopark_ls_sold(uuid, date) from public, anon;
grant execute on function public.snopark_ls_sold(uuid, date) to authenticated, service_role;

-- ---- this season, from the State's packet email of Sep 1 (Dana, Nov 6) ------------------------------------------
do $$ declare e record; begin
  for e in select organization_id, id from public.emails where direction = 'in' and copy_of is null and from_email ~* '@parks\.ca\.gov$'
            and subject ~* '^2026-2027.*vendor registration' order by received_at limit 1 loop
    perform public.snopark_season_open(e.organization_id, '2026-2027', e.id);
  end loop;
end $$;
