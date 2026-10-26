-- 0244 — Dropbox read (Dana, Oct 26). Dana's Dropbox has one "Shaver Lake Sports" folder with every SLS paper in many
-- subfolders. VMS connects to her Dropbox (the admin signs in once; the key never leaves this table), reads one folder
-- she names, lists every file (the dry run), and Claude proposes where each would go by VMS's own rules, never by the
-- Dropbox folder name: a vendor's Documents (invoices, confirmations, credits …) or Accounting Documents (Category /
-- Party / Year). Nothing is filed until Dana approves the list; leftovers stay on one grouped list. Afterwards the same
-- connection watches one scan inbox folder and files new scans on its own (mode 'inbox'), moving them to a Filed subfolder.
-- Vendor papers live in one place (decisions, Oct 26): anything about a vendor goes under that vendor; only papers that
-- are not about a vendor go to Accounting.

create table if not exists public.dropbox_connections (
  organization_id   uuid primary key references public.organizations(id) on delete cascade,
  app_key           text,
  refresh_token     text,
  access_token      text,
  access_token_at   timestamptz,
  account_name      text,
  account_email     text,
  folder_path       text,                       -- as Dropbox shows it, e.g. /Shaver Lake Sports
  folder_path_lower text,
  mode              text not null default 'history' check (mode in ('history', 'inbox')),
  move_filed        boolean not null default false,
  cursor            text,                       -- Dropbox list_folder cursor; null = start over
  scan_done         boolean not null default false,
  reading           boolean not null default false,   -- Claude reads the listed files in the background while true
  oauth_state       text,
  oauth_state_at    timestamptz,
  code_verifier     text,
  connected_at      timestamptz,
  connected_by      uuid references public.profiles(id) on delete set null,
  last_scan_at      timestamptz,
  last_read_at      timestamptz,
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.dropbox_connections enable row level security;
grant all on table public.dropbox_connections to service_role;

create table if not exists public.dropbox_files (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  dropbox_id             text not null,
  path_lower             text not null,
  path_display           text not null,
  name                   text not null,
  folder                 text not null default '',   -- the subfolder under the folder VMS reads, as Dropbox shows it
  size                   bigint,
  content_hash           text,
  modified_at            timestamptz,
  status                 text not null default 'new' check (status in ('new', 'skipped', 'linked', 'proposed', 'leftover', 'approved', 'filed', 'error')),
  target                 text check (target in ('vendor', 'accounting', 'skip')),
  vendor_id              uuid references public.vendors(id) on delete set null,
  kind                   text,                       -- the vendor Documents kind (invoice, confirmation, credit, …)
  doc_year               integer check (doc_year between 1990 and 2100),
  doc_number             text,
  doc_date               date,
  doc_total              numeric(12,2),
  po_number              text,
  accounting             jsonb,                      -- the accounting reading (category, party, year, name pieces)
  vendor_said            text,                       -- the vendor name as printed on the paper
  sure                   boolean,
  note                   text,
  skip_reason            text,
  error                  text,
  sha256                 text,
  vendor_link_id         uuid references public.vendor_links(id) on delete set null,
  accounting_document_id uuid references public.accounting_documents(id) on delete set null,
  read_at                timestamptz,
  filed_at               timestamptz,
  decided_by             uuid references public.profiles(id) on delete set null,
  decided_at             timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (organization_id, dropbox_id)
);
create index if not exists dropbox_files_status_idx on public.dropbox_files (organization_id, status, modified_at desc);
create index if not exists dropbox_files_folder_idx on public.dropbox_files (organization_id, folder);
alter table public.dropbox_files enable row level security;
drop policy if exists "dropbox_files: admin reads" on public.dropbox_files;
drop policy if exists "dropbox_files: admin decides" on public.dropbox_files;
create policy "dropbox_files: admin reads" on public.dropbox_files for select to authenticated using (public.user_in_org(organization_id) and public.is_admin());
create policy "dropbox_files: admin decides" on public.dropbox_files for update to authenticated
  using (public.user_in_org(organization_id) and public.is_admin()) with check (public.user_in_org(organization_id) and public.is_admin());
grant select, update on table public.dropbox_files to authenticated;
grant all on table public.dropbox_files to service_role;

-- Files from Dropbox are a source of their own, so every screen can say where a file came from.
alter table public.vendor_links drop constraint if exists vendor_links_source_check;
alter table public.vendor_links add constraint vendor_links_source_check check (source in ('manual', 'rep_list', 'email', 'vendor_form', 'import', 'upload', 'dropbox'));
alter table public.accounting_documents drop constraint if exists accounting_documents_source_check;
alter table public.accounting_documents add constraint accounting_documents_source_check check (source in ('email', 'upload', 'dropbox'));
alter table public.vendor_links add column if not exists dropbox_path text;
alter table public.accounting_documents add column if not exists dropbox_path text;
comment on column public.vendor_links.dropbox_path is 'Where the file sat in Dropbox when VMS read it (source dropbox).';
comment on column public.accounting_documents.dropbox_path is 'Where the file sat in Dropbox when VMS read it (source dropbox).';

-- The dry-run list: each subfolder with its counts by status.
create or replace function public.dropbox_folder_summary(p_org uuid)
returns table (folder text, total bigint, new_count bigint, proposed bigint, leftover bigint, approved bigint, filed bigint, linked bigint, skipped bigint, errors bigint, sure_proposed bigint)
language sql stable security invoker set search_path = public as $$
  select f.folder, count(*),
    count(*) filter (where f.status = 'new'), count(*) filter (where f.status = 'proposed'), count(*) filter (where f.status = 'leftover'),
    count(*) filter (where f.status = 'approved'), count(*) filter (where f.status = 'filed'), count(*) filter (where f.status = 'linked'),
    count(*) filter (where f.status = 'skipped'), count(*) filter (where f.status = 'error'), count(*) filter (where f.status = 'proposed' and f.sure)
  from public.dropbox_files f where f.organization_id = p_org group by f.folder order by f.folder
$$;
revoke execute on function public.dropbox_folder_summary(uuid) from public, anon;
grant execute on function public.dropbox_folder_summary(uuid) to authenticated, service_role;

-- Approve a folder's proposals (the sure ones, or all of them) or a list of files; the admin's decision, kept with her name.
create or replace function public.dropbox_approve(p_org uuid, p_folder text default null, p_ids uuid[] default null, p_sure_only boolean default true)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n integer;
begin
  if not public.is_admin() or not public.user_in_org(p_org) then raise exception 'Only the admin approves Dropbox filing'; end if;
  update public.dropbox_files set status = 'approved', decided_by = auth.uid(), decided_at = now(), updated_at = now()
  where organization_id = p_org and status = 'proposed'
    and (p_ids is null or id = any(p_ids))
    and (p_folder is null or folder = p_folder)
    and (not p_sure_only or sure);
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke execute on function public.dropbox_approve(uuid, text, uuid[], boolean) from public, anon;
grant execute on function public.dropbox_approve(uuid, text, uuid[], boolean) to authenticated;

-- Live lists: the Settings page refreshes as files are listed, read and filed.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'dropbox_files') then
    alter publication supabase_realtime add table public.dropbox_files;
  end if;
end $$;

-- Every 2 minutes: list more of the folder, read listed files while reading is on, file what is approved, and in inbox
-- mode file new scans on their own.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'dropbox-sync';
    perform cron.schedule('dropbox-sync', '*/2 * * * *',
      $job$select net.http_post(url := 'https://bpdpkytfmpbwpbmpejbf.supabase.co/functions/v1/dropbox', headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mail_cron_secret')), body := '{"action":"sync"}'::jsonb, timeout_milliseconds := 120000)$job$);
  end if;
end $$;
