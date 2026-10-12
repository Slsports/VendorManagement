-- 0109 — Drafts (Dana, Oct 12: "Can you prepare it to send and then I will go in and send it? Do we have a drafts folder?").
-- Mail › Drafts: emails saved before sending, by a person (Save draft) or prepared by Claude for someone to look over and
-- send. Each draft belongs to one person (owner_id); the admin sees all. A draft can also have a copy in the mailbox's Gmail
-- Drafts (gmail_copy); sending from VMS removes that copy.
create table if not exists public.email_drafts (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  owner_id           uuid not null references public.profiles(id) on delete cascade,
  created_by         uuid references public.profiles(id) on delete set null,   -- null: prepared by Claude
  to_emails          text[] not null default '{}',
  cc_emails          text[] not null default '{}',
  subject            text not null default '',
  body               text not null default '',
  thread_id          uuid references public.email_threads(id) on delete set null,
  reply_to_email_id  uuid references public.emails(id) on delete set null,
  forward_email_id   uuid references public.emails(id) on delete set null,
  vendor_id          uuid references public.vendors(id) on delete set null,
  mailbox_id         uuid references public.mailboxes(id) on delete cascade,
  note               text,
  gmail_copy         boolean not null default false,
  gmail_draft_id     text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
comment on table public.email_drafts is 'Mail › Drafts: an email saved before sending (by its owner, or prepared by Claude when created_by is null).';
create index if not exists email_drafts_owner_idx on public.email_drafts (owner_id, updated_at desc);
drop trigger if exists email_drafts_set_updated_at on public.email_drafts;
create trigger email_drafts_set_updated_at before update on public.email_drafts for each row execute function public.set_updated_at();
alter table public.email_drafts enable row level security;
drop policy if exists "email_drafts: owner or admin" on public.email_drafts;
create policy "email_drafts: owner or admin" on public.email_drafts for all to authenticated
  using (public.user_in_org(organization_id) and (owner_id = auth.uid() or public.is_admin()))
  with check (public.user_in_org(organization_id) and (owner_id = auth.uid() or public.is_admin()));
grant select, insert, update, delete on table public.email_drafts to authenticated;
grant all on table public.email_drafts to service_role;
