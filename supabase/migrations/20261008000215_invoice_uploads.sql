-- 0215 — Invoice Uploads (Dana, Oct 20, "go"). Store staff scan or upload paper invoices from a phone, iPad or computer:
-- "The upload an invoice button and once they upload, they can see what they uploaded and then they press submit."
--   • An "Invoice Uploads" login (role uploader) sees only its own uploads, in folders by upload date. Everything else in
--     VMS is closed to it in the database too (user_in_org is false for uploaders), not only hidden on screen.
--   • Submit queues the file; the invoice-uploads function has Claude read it (the scanned-paper reader): it splits a
--     stack into its invoices and reads each one's vendor, number, date, total and the store it was delivered to.
--     "The invoices always have what store it is for, but some vendors call them different than we do": each vendor's
--     Invoice alias (Mountain Milk: Town Store = SLS, Camp Store = GS, Marina = SLM). Nobody picks a store.
--   • Each invoice is filed to the vendor's Documents (Invoices › its year, with its store), the same file the upload
--     folder shows. One already on file (same vendor and number, or the same file) is not saved again: "Already submitted
--     by Cat on Oct 20, 2026". One Claude can't place (vendor, store, unclear) goes to Review › Needs a hand; the store
--     picked there is saved as that vendor's Invoice alias.
--   • Vendors with the Bill.com switch on: the invoice file is sent once to Bill.com and shows "Sent to Bill.com".

-- ---- uploaders see nothing but their own uploads -------------------------------------------------------------------
create or replace function public.user_in_org(org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select organization_id = org_id from public.profiles where id = auth.uid() and is_active and role <> 'uploader'),
    false);
$$;
comment on function public.user_in_org(uuid) is 'Tenant check: true when the calling user belongs to org_id. Invoice Uploads logins (uploader) are not members: they see only their own uploads (Dana, Oct 20).';

/** The signed-in person's organization, uploaders included. */
create or replace function public.my_org_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select organization_id from public.profiles where id = auth.uid() and is_active
$$;
revoke execute on function public.my_org_id() from public, anon;
grant execute on function public.my_org_id() to authenticated, service_role;

drop policy if exists "profiles: read your own" on public.profiles;
create policy "profiles: read your own" on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "organizations: read your own" on public.organizations;
create policy "organizations: read your own" on public.organizations for select to authenticated using (id = public.my_org_id());

-- their own upload folder in vendor-files: <org>/uploads/<their id>/…
drop policy if exists "vendor-files: own uploads read" on storage.objects;
create policy "vendor-files: own uploads read" on storage.objects for select to authenticated
  using (bucket_id = 'vendor-files' and (storage.foldername(name))[1] = public.my_org_id()::text
         and (storage.foldername(name))[2] = 'uploads' and (storage.foldername(name))[3] = auth.uid()::text);
drop policy if exists "vendor-files: own uploads insert" on storage.objects;
create policy "vendor-files: own uploads insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'vendor-files' and (storage.foldername(name))[1] = public.my_org_id()::text
              and (storage.foldername(name))[2] = 'uploads' and (storage.foldername(name))[3] = auth.uid()::text);

-- ---- the store on an invoice ----------------------------------------------------------------------------------------
alter table public.vendors add column if not exists invoice_store_aliases jsonb not null default '{}'::jsonb;
comment on column public.vendors.invoice_store_aliases is 'Invoice alias: what this vendor calls our stores on its invoices, {"Town Store": "SLS"} (Dana, Oct 20).';
update public.vendors set invoice_store_aliases = invoice_store_aliases || '{"Town Store": "SLS", "Camp Store": "GS", "Marina": "SLM"}'::jsonb
 where name = 'MOUNTAIN MILK & CREAM' and merged_into_id is null;

alter table public.vendor_links add column if not exists store_code text;
comment on column public.vendor_links.store_code is 'The store an invoice is for (read from the invoice; Dana, Oct 20).';
alter table public.vendor_links drop constraint if exists vendor_links_source_check;
alter table public.vendor_links add constraint vendor_links_source_check check (source in ('manual', 'rep_list', 'email', 'vendor_form', 'import', 'upload'));

/**
 * Which store an invoice is for, from the store name printed on it: the vendor's Invoice alias first (the longest name
 * it contains), then our store codes, names and aliases (TOWN, MARINA, HAPPY…), whole words; null when unsure.
 */
create or replace function public.store_for_invoice(p_org uuid, p_vendor uuid, p_text text) returns text
language sql stable security definer set search_path = public as $$
  with t as (select nullif(trim(coalesce(p_text, '')), '') as txt),
  vendor_alias as (
    select upper(a.value) as code from public.vendors v, jsonb_each_text(v.invoice_store_aliases) a, t
     where v.id = p_vendor and t.txt is not null and nullif(trim(a.key), '') is not null
       and lower(t.txt) like '%' || lower(trim(a.key)) || '%'
     order by length(a.key) desc limit 1),
  exact as (
    select s.code from public.stores s, t
     where s.organization_id = p_org and t.txt is not null
       and (upper(t.txt) = s.code or lower(t.txt) = lower(s.name) or upper(t.txt) = any (s.aliases))
     limit 1),
  words as (
    select s.code from public.stores s, t
     where s.organization_id = p_org and t.txt is not null
       and (t.txt ~* ('\m' || s.code || '\M') or position(lower(s.name) in lower(t.txt)) > 0
            or exists (select 1 from unnest(s.aliases) al where t.txt ~* ('\m' || al || '\M'))))
  select coalesce((select code from vendor_alias where code in (select code from public.stores where organization_id = p_org)),
                  (select code from exact),
                  (select min(code) from words having count(*) = 1))
$$;
revoke execute on function public.store_for_invoice(uuid, uuid, text) from public, anon;
grant execute on function public.store_for_invoice(uuid, uuid, text) to authenticated, service_role;

-- ---- uploads and the invoices in them -------------------------------------------------------------------------------
create table if not exists public.invoice_uploads (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  uploaded_by     uuid not null references public.profiles(id) on delete restrict,
  uploaded_on     date not null default (now() at time zone 'America/Los_Angeles')::date,
  storage_path    text not null,
  file_name       text not null,
  file_size       bigint,
  file_hash       text,
  page_count      integer,
  status          text not null default 'queued' check (status in ('queued', 'reading', 'done', 'failed', 'duplicate')),
  note            text,
  duplicate_of    uuid references public.invoice_uploads(id) on delete set null,
  attempts        integer not null default 0,
  started_at      timestamptz,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);
comment on table public.invoice_uploads is 'One Submit on Invoice Uploads: the file (photos made into one PDF), who and when; read by the invoice-uploads function.';
create index if not exists invoice_uploads_mine on public.invoice_uploads (uploaded_by, created_at desc);
create index if not exists invoice_uploads_queue on public.invoice_uploads (status, created_at) where status in ('queued', 'reading');
create index if not exists invoice_uploads_hash on public.invoice_uploads (organization_id, file_hash) where file_hash is not null;
alter table public.invoice_uploads enable row level security;
drop policy if exists "invoice_uploads: yours, or editors" on public.invoice_uploads;
create policy "invoice_uploads: yours, or editors" on public.invoice_uploads for select to authenticated
  using (uploaded_by = auth.uid() or (public.user_in_org(organization_id) and public.user_can_edit()));
grant select on table public.invoice_uploads to authenticated;
grant all on table public.invoice_uploads to service_role;

create table if not exists public.invoice_upload_docs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  upload_id        uuid not null references public.invoice_uploads(id) on delete cascade,
  first_page       integer,
  last_page        integer,
  storage_path     text not null,
  vendor_name_read text,
  store_read       text,
  folder           text,
  doc_number       text,
  doc_date         date,
  doc_total        numeric(12,2),
  sure             boolean not null default false,
  vendor_id        uuid references public.vendors(id) on delete set null,
  vendor_name      text,
  store_code       text,
  status           text not null default 'needs_look' check (status in ('filed', 'needs_look', 'duplicate', 'set_aside')),
  reason           text,
  duplicate_note   text,
  vendor_link_id   uuid references public.vendor_links(id) on delete set null,
  review_item_id   uuid references public.review_items(id) on delete set null,
  billcom_sent_at  timestamptz,
  filed_at         timestamptz,
  filed_by         uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
comment on table public.invoice_upload_docs is 'Each invoice Claude found in an upload: what it read, where it was filed, or why it needs a look.';
create index if not exists invoice_upload_docs_upload on public.invoice_upload_docs (upload_id, first_page);
alter table public.invoice_upload_docs enable row level security;
drop policy if exists "invoice_upload_docs: yours, or editors" on public.invoice_upload_docs;
create policy "invoice_upload_docs: yours, or editors" on public.invoice_upload_docs for select to authenticated
  using (exists (select 1 from public.invoice_uploads u where u.id = upload_id
                  and (u.uploaded_by = auth.uid() or (public.user_in_org(u.organization_id) and public.user_can_edit()))));
grant select on table public.invoice_upload_docs to authenticated;
grant all on table public.invoice_upload_docs to service_role;

alter table public.vendor_links add column if not exists upload_id uuid references public.invoice_uploads(id) on delete set null;

-- ---- reading: the function is called when something is waiting ------------------------------------------------------
create or replace function public.invoice_uploads_kick() returns void
language plpgsql security definer set search_path = public as $$
declare secret text;
begin
  if not exists (select 1 from public.invoice_uploads where status = 'queued' or (status = 'reading' and started_at < now() - interval '15 minutes' and attempts < 3)) then return; end if;
  if not exists (select 1 from pg_extension where extname = 'pg_net') then return; end if;
  select decrypted_secret into secret from vault.decrypted_secrets where name = 'mail_cron_secret';
  if secret is null then return; end if;
  perform net.http_post(
    url := 'https://bpdpkytfmpbwpbmpejbf.supabase.co/functions/v1/invoice-uploads',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    body := '{}'::jsonb, timeout_milliseconds := 150000);
exception when others then
  null;
end;
$$;
revoke execute on function public.invoice_uploads_kick() from public, anon, authenticated;
grant execute on function public.invoice_uploads_kick() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'invoice-uploads';
    perform cron.schedule('invoice-uploads', '* * * * *', 'select public.invoice_uploads_kick()');
  end if;
end $$;

-- The next upload to read (the function, one at a time); a read that died is tried again, three times at most.
create or replace function public.invoice_upload_claim() returns public.invoice_uploads
language plpgsql security definer set search_path = public as $$
declare u public.invoice_uploads;
begin
  select * into u from public.invoice_uploads
   where status = 'queued' or (status = 'reading' and started_at < now() - interval '15 minutes' and attempts < 3)
   order by created_at limit 1 for update skip locked;
  if u.id is null then return null; end if;
  update public.invoice_uploads set status = 'reading', attempts = attempts + 1, started_at = now() where id = u.id returning * into u;
  return u;
end;
$$;
revoke execute on function public.invoice_upload_claim() from public, anon, authenticated;
grant execute on function public.invoice_upload_claim() to service_role;

-- "Submit": the file is in the person's upload folder. The same file submitted before is not read again.
create or replace function public.invoice_upload_submit(p_path text, p_name text, p_size bigint, p_hash text, p_pages integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid := public.my_org_id();
  v_id   uuid;
  prev   record;
  v_note text;
begin
  if v_org is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_path is null or p_path not like v_org || '/uploads/' || auth.uid() || '/%' then raise exception 'Upload the file first' using errcode = '22023'; end if;
  if nullif(trim(coalesce(p_hash, '')), '') is not null then
    select u.id, u.uploaded_on, p.full_name into prev from public.invoice_uploads u join public.profiles p on p.id = u.uploaded_by
     where u.organization_id = v_org and u.file_hash = p_hash and u.status <> 'failed' order by u.created_at limit 1;
  end if;
  if prev.id is not null then
    v_note := 'Already submitted by ' || coalesce(nullif(split_part(prev.full_name, ' ', 1), ''), 'someone') || ' on ' || to_char(prev.uploaded_on, 'Mon FMDD, YYYY');
    insert into public.invoice_uploads (organization_id, uploaded_by, storage_path, file_name, file_size, file_hash, page_count, status, note, duplicate_of)
    values (v_org, auth.uid(), p_path, left(coalesce(nullif(trim(p_name), ''), 'Invoice'), 200), p_size, p_hash, p_pages, 'duplicate', v_note, prev.id)
    returning id into v_id;
    return jsonb_build_object('id', v_id, 'duplicate', v_note);
  end if;
  insert into public.invoice_uploads (organization_id, uploaded_by, storage_path, file_name, file_size, file_hash, page_count)
  values (v_org, auth.uid(), p_path, left(coalesce(nullif(trim(p_name), ''), 'Invoice'), 200), p_size, nullif(trim(coalesce(p_hash, '')), ''), p_pages)
  returning id into v_id;
  perform public.invoice_uploads_kick();
  return jsonb_build_object('id', v_id);
end;
$$;
revoke execute on function public.invoice_upload_submit(text, text, bigint, text, integer) from public, anon;
grant execute on function public.invoice_upload_submit(text, text, bigint, text, integer) to authenticated;

-- ---- filing one invoice ---------------------------------------------------------------------------------------------
create or replace function public.upload_folder_kind(p_folder text) returns text
language sql immutable as $$
  select case p_folder when 'invoices' then 'invoice' when 'credits' then 'credit' when 'shipping' then 'packing_slip'
    when 'confirmations' then 'confirmation' when 'orders' then 'order' when 'price_lists' then 'price_list'
    when 'catalogs' then 'catalog' when 'order_forms' then 'order_form' when 'specials' then 'specials' else null end
$$;

/** The same vendor's invoice (or credit, packing slip) with the same number already on file: who and when, else null. */
create or replace function public.invoice_doc_duplicate(p_vendor uuid, p_kind text, p_number text, p_except uuid default null) returns text
language sql stable security definer set search_path = public as $$
  select case
           when u.id is not null then 'Already submitted by ' || coalesce(nullif(split_part(p.full_name, ' ', 1), ''), 'someone') || ' on ' || to_char(u.uploaded_on, 'Mon FMDD, YYYY')
           when l.source = 'email' then 'Already in VMS from their email' || coalesce(', ' || to_char(l.created_at at time zone 'America/Los_Angeles', 'Mon FMDD, YYYY'), '')
           else 'Already in VMS' || coalesce(', filed ' || to_char(l.created_at at time zone 'America/Los_Angeles', 'Mon FMDD, YYYY'), '') || coalesce(' by ' || nullif(split_part(c.full_name, ' ', 1), ''), '')
         end
    from public.vendor_links l
    left join public.invoice_uploads u on u.id = l.upload_id
    left join public.profiles p on p.id = u.uploaded_by
    left join public.profiles c on c.id = l.created_by
   where l.vendor_id = p_vendor and l.kind = p_kind and (p_except is null or l.id <> p_except)
     and nullif(regexp_replace(public.po_norm(p_number), '^0+', ''), '') is not null
     and regexp_replace(public.po_norm(l.doc_number), '^0+', '') = regexp_replace(public.po_norm(p_number), '^0+', '')
   order by l.created_at limit 1
$$;
revoke execute on function public.invoice_doc_duplicate(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.invoice_doc_duplicate(uuid, text, text, uuid) to service_role;

/**
 * File one invoice Claude found in an upload, or say why it needs a look (a Review card). Internal: the function and
 * invoice_upload_resolve call it. Returns filed / duplicate / needs_look.
 */
create or replace function public.invoice_upload_place(p_doc uuid, p_by uuid default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  d      public.invoice_upload_docs%rowtype;
  u      public.invoice_uploads%rowtype;
  v      public.vendors%rowtype;
  v_kind text;
  v_dup  text;
  v_why  text;
  v_link uuid;
  v_day  date;
  v_who  text;
begin
  select * into d from public.invoice_upload_docs where id = p_doc for update;
  if d.id is null or d.status in ('filed', 'duplicate') then return d.status; end if;
  select * into u from public.invoice_uploads where id = d.upload_id;
  select * into v from public.vendors where id = d.vendor_id;
  if v.id is not null and v.merged_into_id is not null then
    select * into v from public.vendors where id = v.merged_into_id;
  end if;
  if v.id is not null and d.store_code is null then
    d.store_code := public.store_for_invoice(d.organization_id, v.id, d.store_read);
  end if;
  v_kind := public.upload_folder_kind(d.folder);
  v_why := case
    when v.id is null and d.vendor_name_read is not null then 'Claude read "' || d.vendor_name_read || '"; no vendor by that name'
    when v.id is null then 'Claude could not read the vendor'
    when v_kind is null then 'Claude is not sure what kind of paper this is'
    when d.store_code is null and d.store_read is not null then 'Claude read the store as "' || d.store_read || '"; which store is that?'
    when d.store_code is null then 'No store on it that Claude could read'
    when not d.sure then 'Faded, handwritten or unclear: check what Claude read'
  end;
  if v_why is not null then
    update public.invoice_upload_docs set status = 'needs_look', reason = v_why, vendor_id = v.id, vendor_name = v.name, store_code = d.store_code where id = d.id;
    if d.review_item_id is null or not exists (select 1 from public.review_items where id = d.review_item_id and status = 'pending') then
      select full_name into v_who from public.profiles where id = u.uploaded_by;
      insert into public.review_items (organization_id, kind, entity_type, entity_id, title, details)
      values (d.organization_id, 'invoice_upload', 'invoice_upload_doc', d.id,
              left('Scanned ' || coalesce(case v_kind when 'credit' then 'credit' when 'packing_slip' then 'packing slip' else null end, 'invoice')
                   || coalesce(' from ' || coalesce(v.name, d.vendor_name_read), '') || coalesce(' #' || d.doc_number, '')
                   || ', uploaded by ' || coalesce(nullif(split_part(v_who, ' ', 1), ''), 'someone') || ' ' || to_char(u.uploaded_on, 'Mon FMDD, YYYY'), 200),
              jsonb_build_object('reason', v_why, 'upload_id', u.id, 'store_read', d.store_read, 'vendor_name_read', d.vendor_name_read))
      returning id into d.review_item_id;
      update public.invoice_upload_docs set review_item_id = d.review_item_id where id = d.id;
    end if;
    return 'needs_look';
  end if;

  if v_kind in ('invoice', 'credit', 'packing_slip') then
    v_dup := public.invoice_doc_duplicate(v.id, v_kind, d.doc_number);
  end if;
  if v_dup is not null then
    update public.invoice_upload_docs set status = 'duplicate', duplicate_note = v_dup, vendor_id = v.id, vendor_name = v.name, store_code = d.store_code, reason = null where id = d.id;
    update public.review_items set status = 'accepted', resolved_at = now(), resolved_by = p_by, resolution_note = v_dup where id = d.review_item_id and status = 'pending';
    return 'duplicate';
  end if;

  v_day := coalesce(d.doc_date, u.uploaded_on);
  select full_name into v_who from public.profiles where id = u.uploaded_by;
  insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name, mime_type, received_at, doc_year,
                                   source, notes, created_by, doc_number, doc_date, doc_total, store_code, upload_id)
  values (d.organization_id, v.id, v_kind,
          left(case v_kind when 'invoice' then 'Invoice' when 'credit' then 'Credit' when 'packing_slip' then 'Packing slip' else initcap(replace(v_kind, '_', ' ')) end
               || coalesce(' ' || d.doc_number, '') || ' · ' || d.store_code, 200),
          d.storage_path,
          left(regexp_replace(v.name || ' ' || coalesce(d.doc_number, to_char(v_day, 'YYYY-MM-DD')) || ' ' || d.store_code, '[^A-Za-z0-9 #&._-]', '', 'g') || '.pdf', 200),
          'application/pdf', v_day, extract(year from v_day)::int, 'upload',
          left('Uploaded by ' || coalesce(nullif(v_who, ''), 'someone') || ' on ' || to_char(u.uploaded_on, 'Mon FMDD, YYYY'), 1000),
          u.uploaded_by, d.doc_number, d.doc_date, d.doc_total, d.store_code, u.id)
  returning id into v_link;
  update public.invoice_upload_docs set status = 'filed', vendor_link_id = v_link, vendor_id = v.id, vendor_name = v.name, store_code = d.store_code,
         reason = null, filed_at = now(), filed_by = p_by where id = d.id;
  update public.review_items set status = 'accepted', resolved_at = now(), resolved_by = p_by, resolution_note = 'Filed to ' || v.name where id = d.review_item_id and status = 'pending';
  return 'filed';
end;
$$;
revoke execute on function public.invoice_upload_place(uuid, uuid) from public, anon, authenticated;
grant execute on function public.invoice_upload_place(uuid, uuid) to service_role;

/**
 * The Needs a look card: the vendor, store and folder a person picked, then filed. The store picked for a store name
 * Claude read becomes that vendor's Invoice alias, so the next one files itself. 'set_aside' leaves it unfiled.
 */
create or replace function public.invoice_upload_resolve(p_doc uuid, p_vendor uuid, p_store text, p_folder text, p_action text default 'file')
returns text language plpgsql security definer set search_path = public as $$
declare d public.invoice_upload_docs%rowtype;
begin
  select * into d from public.invoice_upload_docs where id = p_doc;
  if d.id is null or not public.user_in_org(d.organization_id) or not public.user_can_edit() then raise exception 'Not found' using errcode = '23503'; end if;
  if p_action = 'set_aside' then
    update public.invoice_upload_docs set status = 'set_aside', reason = 'Set aside by ' || (select split_part(full_name, ' ', 1) from public.profiles where id = auth.uid()) where id = d.id;
    update public.review_items set status = 'rejected', resolved_at = now(), resolved_by = auth.uid(), resolution_note = 'Set aside' where id = d.review_item_id and status = 'pending';
    return 'set_aside';
  end if;
  if p_vendor is null or not exists (select 1 from public.vendors where id = p_vendor and organization_id = d.organization_id) then raise exception 'Pick the vendor' using errcode = '22023'; end if;
  if p_store is null or not exists (select 1 from public.stores where organization_id = d.organization_id and code = upper(p_store)) then raise exception 'Pick the store' using errcode = '22023'; end if;
  if public.upload_folder_kind(p_folder) is null then raise exception 'Pick the folder' using errcode = '22023'; end if;
  if nullif(trim(coalesce(d.store_read, '')), '') is not null
     and public.store_for_invoice(d.organization_id, p_vendor, d.store_read) is distinct from upper(p_store) then
    update public.vendors set invoice_store_aliases = invoice_store_aliases || jsonb_build_object(trim(d.store_read), upper(p_store)) where id = p_vendor;
  end if;
  update public.invoice_upload_docs set vendor_id = p_vendor, store_code = upper(p_store), folder = p_folder, sure = true, status = 'needs_look' where id = d.id;
  return public.invoice_upload_place(d.id, auth.uid());
end;
$$;
revoke execute on function public.invoice_upload_resolve(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.invoice_upload_resolve(uuid, uuid, text, text, text) to authenticated;

-- ---- Bill.com: uploaded invoices go too ----------------------------------------------------------------------------
alter table public.billcom_forwards alter column email_id drop not null;
create unique index if not exists billcom_forwards_upload_link on public.billcom_forwards (vendor_link_id) where email_id is null;

create or replace function public.vendor_links_billcom() returns trigger
language plpgsql security definer set search_path = public as $$
declare fid uuid; e record; v_on timestamptz;
begin
  if new.kind <> 'invoice' or new.vendor_id is null or new.storage_path is null then return new; end if;
  select billcom_send_on_at into v_on from public.vendors v where v.id = new.vendor_id and v.billcom_send;
  if v_on is null then return new; end if;
  -- an invoice scanned into Invoice Uploads (Dana, Oct 20): the file itself goes
  if new.source = 'upload' then
    if new.created_at < date_trunc('day', v_on at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles' then return new; end if;
    insert into public.billcom_forwards (organization_id, email_id, vendor_link_id, vendor_id)
    values (new.organization_id, null, new.id, new.vendor_id)
    on conflict (vendor_link_id) where email_id is null do nothing
    returning id into fid;
    if fid is not null then perform public.billcom_forward_kick(fid); end if;
    return new;
  end if;
  if new.source <> 'email' or new.email_id is null then return new; end if;
  select direction, billcom_sent_at, received_at into e from public.emails where id = new.email_id;
  if e is null or e.direction = 'out' or e.billcom_sent_at is not null then return new; end if;
  if e.received_at < date_trunc('day', v_on at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles' then return new; end if;
  insert into public.billcom_forwards (organization_id, email_id, vendor_link_id, vendor_id)
  values (new.organization_id, new.email_id, new.id, new.vendor_id)
  on conflict (email_id) do nothing
  returning id into fid;
  if fid is not null then perform public.billcom_forward_kick(fid); end if;
  return new;
end;
$$;
