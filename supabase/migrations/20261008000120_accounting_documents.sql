-- 0120 — Accounting documents (docs/accounting-plan.md §4; Dana, Oct 16: "Start on the document filing and drop box").
-- Every paper that comes to billing@ (and files dropped from Dana's computer) is read by Claude and filed into
-- Accounting folders: Category / Party / Year the document is about, with a file name by the convention
-- (decisions, Oct 16): "2026-09-25 P&S Cal Fair COM 0301476591 SLS Building $4472 paid.pdf". The file itself is kept
-- in its own bucket (accounting-files) under an opaque path; the folder and name live on the row, so moving or
-- renaming never copies a file. No duplicates: the same bytes (sha256) are one document, however often they arrive.
-- Seen only with the Accounting tick (sees_accounting), like the rest of the area.

create table if not exists public.accounting_documents (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  category         text not null default 'other'
                   check (category in ('taxes', 'insurance', 'banking', 'payroll', 'donations', 'contracts', 'accounting_firm', 'bills', 'other')),
  party            text not null default '',                 -- the folder under the category: Cal Fair, SCE Licensing, Hub
  doc_year         integer not null check (doc_year between 1990 and 2100),
  file_name        text not null check (length(trim(file_name)) > 0 and position('/' in file_name) = 0),
  kind             text not null default 'other'
                   check (kind in ('invoice', 'receipt', 'statement', 'policy', 'certificate', 'license', 'contract', 'letter', 'form', 'tax_return', 'notice', 'report', 'check', 'other')),
  whose            text not null default '' check (whose in ('', 'SLS', 'P&S', 'SLM', 'GS')),
  doc_date         date,
  number           text not null default '',                 -- policy, account, license or invoice number as printed
  what             text not null default '',                 -- the short "what it is" part of the name
  amount           numeric(12, 2),
  status_word      text not null default '',                 -- paid, executed, signed, due …
  contact_id       uuid references public.accounting_contacts(id) on delete set null,
  policy_id        uuid references public.accounting_policies(id) on delete set null,
  contract_id      uuid references public.accounting_contracts(id) on delete set null,
  storage_path     text not null,                            -- accounting-files/<org>/<uuid>.<ext>
  mime_type        text,
  size             bigint not null default 0,
  sha256           text not null,
  source           text not null default 'email' check (source in ('email', 'upload')),
  email_id         uuid references public.emails(id) on delete set null,
  attachment_id    uuid references public.email_attachments(id) on delete set null,
  original_name    text not null default '',
  uploaded_by      uuid references public.profiles(id) on delete set null,
  status           text not null default 'filed' check (status in ('new', 'filed', 'review')),
  sure             boolean not null default true,
  claude_note      text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (organization_id, sha256)
);
comment on table public.accounting_documents is 'Accounting papers filed by Claude into Category / Party / Year, named by the convention; the bytes live in the accounting-files bucket.';
create index if not exists accounting_documents_folder_idx on public.accounting_documents (organization_id, category, party, doc_year);
create index if not exists accounting_documents_status_idx on public.accounting_documents (organization_id, status);
create index if not exists accounting_documents_policy_idx on public.accounting_documents (policy_id) where policy_id is not null;
create index if not exists accounting_documents_contract_idx on public.accounting_documents (contract_id) where contract_id is not null;
drop trigger if exists accounting_documents_touch on public.accounting_documents;
create trigger accounting_documents_touch before update on public.accounting_documents for each row execute function public.set_updated_at();

-- Which attachment became which document, and why one was left in the email (a signature picture, a catalog).
alter table public.email_attachments add column if not exists accounting_document_id uuid references public.accounting_documents(id) on delete set null;
alter table public.email_attachments add column if not exists accounting_skip text;
comment on column public.email_attachments.accounting_skip is 'Why the accounting filing left this attachment in the email (picture, catalog, too big …); null when filed or not looked at yet.';
-- The filing step's queue: an email in the accounting mailbox is looked at once; the stamp says when.
alter table public.emails add column if not exists accounting_filed_at timestamptz;
create index if not exists emails_accounting_queue_idx on public.emails (mailbox_id, received_at desc) where accounting_filed_at is null and has_attachments;

-- ---- the bucket: Accounting only -----------------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('accounting-files', 'accounting-files', false, 52428800)
on conflict (id) do nothing;
drop policy if exists "accounting-files: accounting read" on storage.objects;
drop policy if exists "accounting-files: accounting insert" on storage.objects;
drop policy if exists "accounting-files: accounting update" on storage.objects;
drop policy if exists "accounting-files: accounting delete" on storage.objects;
create policy "accounting-files: accounting read" on storage.objects for select to authenticated
  using (bucket_id = 'accounting-files' and public.sees_accounting() and public.user_in_org(((storage.foldername(name))[1])::uuid));
create policy "accounting-files: accounting insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'accounting-files' and public.sees_accounting() and public.user_in_org(((storage.foldername(name))[1])::uuid));
create policy "accounting-files: accounting update" on storage.objects for update to authenticated
  using (bucket_id = 'accounting-files' and public.sees_accounting() and public.user_in_org(((storage.foldername(name))[1])::uuid));
create policy "accounting-files: accounting delete" on storage.objects for delete to authenticated
  using (bucket_id = 'accounting-files' and public.sees_accounting() and public.user_in_org(((storage.foldername(name))[1])::uuid));

-- ---- grants and RLS ------------------------------------------------------------------------------------------------
grant select, insert, update, delete on public.accounting_documents to authenticated;
grant all on public.accounting_documents to service_role;
alter table public.accounting_documents enable row level security;
drop policy if exists "accounting_documents: accounting read" on public.accounting_documents;
drop policy if exists "accounting_documents: accounting write" on public.accounting_documents;
create policy "accounting_documents: accounting read" on public.accounting_documents for select to authenticated
  using (public.user_in_org(organization_id) and public.sees_accounting());
create policy "accounting_documents: accounting write" on public.accounting_documents for all to authenticated
  using (public.user_in_org(organization_id) and public.sees_accounting())
  with check (public.user_in_org(organization_id) and public.sees_accounting());

-- ---- the folder tree with counts, for the Documents page ----------------------------------------------------------
create or replace function public.accounting_document_folders(p_org uuid)
returns table (category text, party text, doc_year integer, n bigint, review_n bigint)
language sql stable security invoker set search_path = public as $$
  select d.category, d.party, d.doc_year, count(*), count(*) filter (where d.status = 'review')
    from public.accounting_documents d
   where d.organization_id = p_org and d.status <> 'new'
   group by d.category, d.party, d.doc_year
   order by d.category, d.party, d.doc_year desc
$$;
revoke execute on function public.accounting_document_folders(uuid) from public, anon;
grant execute on function public.accounting_document_folders(uuid) to authenticated, service_role;

-- ---- the file name by the convention (Dana, Oct 16) --------------------------------------------------------------
-- "<date> <whose> <party> <number> <what> $<amount> <status>.<ext>": always abbreviated, no dash, whole dollars unless
-- cents were paid. Built here so a rename after an edit on the page follows the same rule as Claude's first filing.
create or replace function public.accounting_document_name(
  p_date date, p_whose text, p_party text, p_number text, p_what text, p_amount numeric, p_status text, p_ext text)
returns text language sql immutable as $$
  select regexp_replace(trim(concat_ws(' ',
           to_char(p_date, 'YYYY-MM-DD'), nullif(trim(p_whose), ''), nullif(trim(p_party), ''), nullif(trim(p_number), ''), nullif(trim(p_what), ''),
           case when p_amount is null then null
                when p_amount = trunc(p_amount) then '$' || trunc(p_amount)::text
                else '$' || to_char(p_amount, 'FM9999999990.00') end,
           nullif(trim(p_status), ''))), '\s+', ' ', 'g')
         || case when coalesce(p_ext, '') <> '' then '.' || lower(p_ext) else '' end
$$;
grant execute on function public.accounting_document_name(date, text, text, text, text, numeric, text, text) to authenticated, service_role;

-- Keep the name in step with the facts when a row is edited on the page (never when the name itself was typed).
create or replace function public.accounting_documents_rename() returns trigger
language plpgsql as $$
declare v_ext text;
begin
  if tg_op = 'UPDATE' and new.file_name is distinct from old.file_name then return new; end if;
  if tg_op = 'UPDATE' and (new.doc_date, new.whose, new.party, new.number, new.what, new.amount, new.status_word)
       is not distinct from (old.doc_date, old.whose, old.party, old.number, old.what, old.amount, old.status_word) then return new; end if;
  v_ext := nullif(regexp_replace(new.file_name, '^.*\.([A-Za-z0-9]{1,5})$', '\1'), new.file_name);
  if new.doc_date is not null and new.party <> '' then
    new.file_name := public.accounting_document_name(new.doc_date, new.whose, new.party, new.number, new.what, new.amount, new.status_word, v_ext);
  end if;
  return new;
end;
$$;
drop trigger if exists accounting_documents_rename on public.accounting_documents;
create trigger accounting_documents_rename before update on public.accounting_documents for each row execute function public.accounting_documents_rename();
