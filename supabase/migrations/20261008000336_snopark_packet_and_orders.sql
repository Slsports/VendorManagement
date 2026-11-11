-- Sno-Park: the State's packet filed by VMS, the agreement and the first order filled and drafted for Dana, Cat's orders,
-- the map to print, the flowchart link, Dana's signature (Dana, Nov 10, 2026).
-- "when we get the annual paperwork from them vms fills out the Vendor Registration form for me along with our first order
-- (same quantities as this years), use my digital signature and create a draft email so I can review then email to them.
-- The vendor packet always comes in a zip file. You unzip it and the docs get filed in 3 folders under documents: Orders,
-- Payment Submissions, Vendor Packet." / "The map also needs to be printed each year … the system tells her to print the
-- map" / "a link on the receiving page and the vendor page to the workflow doc they provide" / orders named her way:
-- "#1 - 11-2-26 - OHV 145SP-2026-2027 - SLS Vendor Permit Request Form"; subject "Sno-Park Permit Request #n – season";
-- Cat sends, a copy goes to Dana.

-- ---- Dana's signature: a private bucket only the admin reads or writes (the snopark function uses the service role) ------
insert into storage.buckets (id, name, public, file_size_limit) values ('signatures', 'signatures', false, 5242880) on conflict (id) do nothing;
drop policy if exists "signatures: admin read" on storage.objects;
drop policy if exists "signatures: admin insert" on storage.objects;
drop policy if exists "signatures: admin update" on storage.objects;
drop policy if exists "signatures: admin delete" on storage.objects;
create policy "signatures: admin read" on storage.objects for select to authenticated using (bucket_id = 'signatures' and public.is_admin() and public.user_in_org(((storage.foldername(name))[1])::uuid));
create policy "signatures: admin insert" on storage.objects for insert to authenticated with check (bucket_id = 'signatures' and public.is_admin() and public.user_in_org(((storage.foldername(name))[1])::uuid));
create policy "signatures: admin update" on storage.objects for update to authenticated using (bucket_id = 'signatures' and public.is_admin() and public.user_in_org(((storage.foldername(name))[1])::uuid));
create policy "signatures: admin delete" on storage.objects for delete to authenticated using (bucket_id = 'signatures' and public.is_admin() and public.user_in_org(((storage.foldername(name))[1])::uuid));
alter table public.profiles add column if not exists signature_path text;
comment on column public.profiles.signature_path is 'The person''s handwritten signature (PNG) in the signatures bucket; VMS places it on forms it fills for them.';

-- the store's standing answers on the State's agreement (from Dana's signed 2026-2027 form); edited here, never in code
alter table public.organizations add column if not exists snopark_agreement jsonb;
update public.organizations set snopark_agreement = jsonb_build_object(
  'business_name', 'SHAVER LAKE SPORTS', 'owner', 'GREG POWELL', 'fein', '71-0923248', 'county_license', 'COUNTY - NO LIC REQUIRED', 'resale', '100-148744',
  'street', '41777 Tollhouse Road', 'city', 'SHAVER LAKE', 'state', 'CA', 'zip', '93664', 'county', 'FRESNO', 'phone', '559-841-2740', 'additional_locations', false,
  'public_email', 'SHAVERLAKESPORTS@GMAIL.COM', 'website', 'SHAVERLAKESPORTS.COM', 'sold_on_website', false,
  'contact', 'DANA POWELL', 'contact_title', 'ACCOUNTING MANAGER', 'direct_phone', '480-717-7799', 'direct_email', 'BILLING.SLSPORTS@GMAIL.COM',
  'mailing_street', 'PO BOX 60', 'mailing_city', 'SHAVER LAKE', 'mailing_state', 'CA', 'mailing_zip', '93664',
  'package_street', '41777 Tollhouse Road', 'package_city', 'SHAVER LAKE', 'package_state', 'CA', 'package_zip', '93664',
  'year_round', true, 'hours', jsonb_build_array('8-5', '8-5', '8-5', '8-5', '8-5', '8-6', '7-6'))
 where snopark_agreement is null;

-- ---- files: the packet's documents and the filled agreement -------------------------------------------------------
alter table public.vendor_links drop constraint if exists vendor_links_kind_check;
alter table public.vendor_links add constraint vendor_links_kind_check check (kind in ('catalog', 'price_list', 'order_form', 'specials', 'website', 'other', 'invoice', 'credit', 'confirmation', 'order', 'ls_po', 'packing_slip', 'payment', 'freight_bill', 'delivery_receipt', 'image', 'approved_proof', 'damage_photo', 'sales_report', 'proof', 'inventory_count', 'snopark_report', 'snopark_scan', 'snopark_form', 'snopark_sheet', 'snopark_print', 'snopark_packet', 'snopark_final_packet', 'snopark_packet_doc', 'snopark_agreement'));

-- ---- the season: the packet, the map, the flowchart -------------------------------------------------------------
alter table public.snopark_seasons add column if not exists packet_status text check (packet_status in ('pending', 'filed', 'error'));
alter table public.snopark_seasons add column if not exists packet_error text;
alter table public.snopark_seasons add column if not exists packet_filed_at timestamptz;
alter table public.snopark_seasons add column if not exists agreement_link_id uuid references public.vendor_links(id) on delete set null;
alter table public.snopark_seasons add column if not exists flowchart_link_id uuid references public.vendor_links(id) on delete set null;
alter table public.snopark_seasons add column if not exists map_link_id uuid references public.vendor_links(id) on delete set null;
alter table public.snopark_seasons add column if not exists map_printed_at timestamptz;
alter table public.snopark_seasons add column if not exists map_task_id uuid references public.tasks(id) on delete set null;
alter table public.snopark_seasons add column if not exists packet_draft_id uuid references public.email_drafts(id) on delete set null;
-- this season's packet is filed from the email already in VMS (the agreement and first order went back on Nov 2)
update public.snopark_seasons set packet_status = 'pending' where packet_filed_at is null and opened_email_id is not null;

-- a new season's packet is filed as soon as the season opens (the cron picks it up within minutes)
create or replace function public.snopark_season_open(p_org uuid, p_label text, p_email uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_season uuid; v_year integer; v_vendor uuid; v_admin uuid; v_thread uuid; v_task uuid;
begin
  select id into v_season from public.snopark_seasons where organization_id = p_org and label = p_label;
  if v_season is not null then return v_season; end if;
  v_year := substr(p_label, 1, 4)::integer;
  v_vendor := public.snopark_vendor(p_org);
  insert into public.snopark_seasons (organization_id, vendor_id, label, opened_email_id, first_report_month, season_end, final_due, packet_status)
  values (p_org, v_vendor, p_label, p_email, make_date(v_year, 11, 1), make_date(v_year + 1, 5, 30), make_date(v_year + 1, 6, 20), case when p_email is null then null else 'pending' end)
  returning id into v_season;
  -- Dana returns the packet with the first order; VMS fills both and drafts the email (Nov 10), she reads it and presses Send
  v_admin := public.org_admin(p_org);
  if v_admin is not null then
    select thread_id into v_thread from public.emails where id = p_email;
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, vendor_id, thread_id, auto_key, area)
    values (p_org, left('Sno-Park ' || p_label || ': send the vendor agreement and the first order', 200),
            'The State emailed this season''s vendor packet. VMS is filing it, filling in the agreement (OHV 56SP) with your signature and the first permit request (OHV 145SP) with the same books as last season''s first order, and writing the reply for you. Read the draft over and press Send. The books come by FedEx in 5-10 business days; receive them on the Sno-Park page when they arrive.',
            current_date + 14, now() + interval '7 days', v_admin, v_admin, v_vendor, v_thread, 'snopark_packet:' || v_season, 'general')
    on conflict (organization_id, auto_key) where auto_key is not null do nothing
    returning id into v_task;
  end if;
  return v_season;
end $$;

-- ---- orders to the State ------------------------------------------------------------------------------------------
create table if not exists public.snopark_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  season_id uuid not null references public.snopark_seasons(id) on delete cascade,
  seq integer not null,                                   -- #1, #2 … in the season
  day_books integer not null default 0 check (day_books >= 0),
  season_books integer not null default 0 check (season_books >= 0),
  requested_on date not null default current_date,
  requested_by uuid references public.profiles(id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'received')),
  order_id uuid references public.orders(id) on delete set null,          -- the VMS order (PO, receiving, paperwork)
  file_link_id uuid references public.vendor_links(id) on delete set null, -- the filled form, in Orders
  draft_id uuid references public.email_drafts(id) on delete set null,
  task_id uuid references public.tasks(id) on delete set null,
  email_id uuid references public.emails(id) on delete set null,
  sent_on date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_id, seq)
);
alter table public.snopark_orders enable row level security;
create policy snopark_orders_read on public.snopark_orders for select to authenticated using (public.user_in_org(organization_id));
create policy snopark_orders_edit on public.snopark_orders for update to authenticated using (public.user_in_org(organization_id) and public.user_can_edit()) with check (public.user_in_org(organization_id));
grant select, update on public.snopark_orders to authenticated;
grant all on public.snopark_orders to service_role;
create trigger snopark_orders_touch before update on public.snopark_orders for each row execute function public.set_updated_at();
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'snopark_orders') then
    alter publication supabase_realtime add table public.snopark_orders;
  end if;
end $$;

-- The name Dana gives an order file: "#1 - 11-2-26 - OHV 145SP-2026-2027 - SLS Vendor Permit Request Form".
create or replace function public.snopark_order_name(p_seq integer, p_on date, p_label text) returns text
language sql immutable as $$
  select '#' || p_seq || ' - ' || to_char(p_on, 'FMMM-FMDD-YY') || ' - OHV 145SP-' || p_label || ' - SLS Vendor Permit Request Form'
$$;

-- A new order: the next number in the season and the VMS order behind it (its PO comes from the orders rules). A person
-- (editor) or the snopark function (no user: the first order of a season, made with the packet) starts one.
create or replace function public.snopark_order_start(p_season uuid, p_day_books integer, p_season_books integer, p_requested_on date default current_date, p_by uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare s public.snopark_seasons%rowtype; v_seq integer; v_order uuid; v_id uuid; v_by uuid := coalesce(auth.uid(), p_by);
begin
  if auth.uid() is not null and not public.user_can_edit() then raise exception 'Only admins, managers and buyers order permits' using errcode = '42501'; end if;
  select * into s from public.snopark_seasons where id = p_season and (auth.uid() is null or public.user_in_org(organization_id));
  if s.id is null then raise exception 'Season not found' using errcode = '22023'; end if;
  if coalesce(p_day_books, 0) + coalesce(p_season_books, 0) < 1 then raise exception 'How many day books and season books?' using errcode = '22023'; end if;
  select coalesce(max(seq), 0) + 1 into v_seq from public.snopark_orders where season_id = p_season;
  insert into public.orders (organization_id, vendor_id, status, order_date, description, source, placed_by_id, created_by, store_codes)
  values (s.organization_id, s.vendor_id, 'open', coalesce(p_requested_on, current_date),
          'Sno-Park permit request #' || v_seq || ' (' || s.label || '): ' || coalesce(p_day_books, 0) || ' day books, ' || coalesce(p_season_books, 0) || ' season books', 'manual', v_by, v_by, array['SLS'])
  returning id into v_order;
  insert into public.snopark_orders (organization_id, season_id, seq, day_books, season_books, requested_on, requested_by, order_id)
  values (s.organization_id, p_season, v_seq, coalesce(p_day_books, 0), coalesce(p_season_books, 0), coalesce(p_requested_on, current_date), v_by, v_order)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.snopark_order_start(uuid, integer, integer, date, uuid) from public, anon;
grant execute on function public.snopark_order_start(uuid, integer, integer, date, uuid) to authenticated, service_role;

-- An order emailed to the State (the subject carries its number) is sent; the first order goes with the packet reply.
create or replace function public.emails_snopark_order_sent() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_seq integer; v_label text; v_season uuid;
begin
  if new.direction <> 'out' then return new; end if;
  v_seq := nullif(substring(coalesce(new.subject, '') from 'Sno-Park Permit Request #(\d+)'), '')::integer;
  v_label := substring(coalesce(new.subject, '') from '(\d{4}-\d{4})');
  if v_seq is not null and v_label is not null then
    update public.snopark_orders o set status = 'sent', email_id = new.id, sent_on = (new.received_at at time zone 'America/Los_Angeles')::date
      from public.snopark_seasons s where s.id = o.season_id and s.organization_id = new.organization_id and s.label = v_label and o.seq = v_seq and o.status = 'draft';
  elsif new.thread_id is not null then
    -- our reply in the State's vendor registration conversation carries the first order
    select s.id into v_season from public.snopark_seasons s join public.emails e on e.id = s.opened_email_id where e.thread_id = new.thread_id and s.organization_id = new.organization_id limit 1;
    if v_season is not null then
      update public.snopark_orders set status = 'sent', email_id = new.id, sent_on = (new.received_at at time zone 'America/Los_Angeles')::date where season_id = v_season and seq = 1 and status = 'draft';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists emails_snopark_order_sent on public.emails;
create trigger emails_snopark_order_sent after insert on public.emails for each row execute function public.emails_snopark_order_sent();

-- ---- the map to print when the first box of the season arrives --------------------------------------------------
create or replace function public.snopark_shipment_done(p_shipment uuid, p_ls_order text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare sh public.snopark_shipments%rowtype; s public.snopark_seasons%rowtype; v_task uuid; v_who uuid;
begin
  select * into sh from public.snopark_shipments where id = p_shipment;
  if sh.id is null then return; end if;
  update public.snopark_shipments set status = 'done', ls_order_id = p_ls_order, ls_done_at = now(), ls_note = p_note where id = sh.id;
  if sh.order_id is not null then
    update public.orders set status = 'received', date_received = coalesce(date_received, sh.received_on), date_entered_ls = coalesce(date_entered_ls, current_date), ls_order_id = coalesce(ls_order_id, p_ls_order) where id = sh.order_id;
    update public.snopark_orders set status = 'received' where order_id = sh.order_id and status <> 'received';
  end if;
  update public.tasks set done_at = now(), closed_how = 'vms', remind_at = null,
         done_note = 'The box balanced against the State''s sheet' || case when sh.accepted_note is not null then ' (accepted by Dana: ' || sh.accepted_note || ')' else '' end || ' and the books went into Lightspeed' || case when p_ls_order is not null then ' as PO ' || p_ls_order else '' end || '.'
   where id = sh.task_id and done_at is null;
  -- the season's map goes by the register: whoever received the first box prints it (Dana, Nov 10)
  select * into s from public.snopark_seasons where id = sh.season_id;
  if s.map_link_id is not null and s.map_printed_at is null and s.map_task_id is null then
    v_who := coalesce(sh.received_by, public.snopark_owner(s.id), public.org_admin(s.organization_id));
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, created_by, vendor_id, auto_key, area)
    values (s.organization_id, 'Print the ' || s.label || ' Sno-Park map and make copies for the register',
            'The first box of Sno-Park books is in. Print this season''s Sno-Park map (it is on the receiving page and the Sno-Park page), make copies and put them by the register. Mark it printed on the receiving page.',
            current_date + 3, now(), v_who, v_who, s.vendor_id, 'snopark_map:' || s.id, 'general')
    on conflict (organization_id, auto_key) where auto_key is not null do nothing returning id into v_task;
    update public.snopark_seasons set map_task_id = v_task where id = s.id and v_task is not null;
  end if;
end $$;

create or replace function public.snopark_map_printed(p_season uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s public.snopark_seasons%rowtype;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers mark the map printed' using errcode = '42501'; end if;
  select * into s from public.snopark_seasons where id = p_season and public.user_in_org(organization_id);
  if s.id is null then raise exception 'Season not found' using errcode = '22023'; end if;
  update public.snopark_seasons set map_printed_at = now() where id = s.id;
  update public.tasks set done_at = now(), done_by = auth.uid(), closed_how = 'person', remind_at = null, done_note = 'Map printed and copies made for the register.'
   where id = s.map_task_id and done_at is null;
end $$;
revoke execute on function public.snopark_map_printed(uuid) from public, anon;
grant execute on function public.snopark_map_printed(uuid) to authenticated;

-- ---- the packet cron: every 10 minutes, seasons whose packet waits to be filed ------------------------------------
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'snopark-packets';
    perform cron.schedule('snopark-packets', '*/10 * * * *',
      $job$select net.http_post(url := 'https://bpdpkytfmpbwpbmpejbf.supabase.co/functions/v1/snopark', headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mail_cron_secret')), body := '{"job":"packets"}'::jsonb, timeout_milliseconds := 150000)$job$);
  end if;
end $$;
