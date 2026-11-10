-- 0328 — A draft keeps its files (Dana, Nov 9: "I should be able to save this to my drafts with the order attached").
-- Files attached from the computer, or made by VMS (the suggested order's Excel sheet), were dropped when an email was
-- saved to Drafts. Now Save draft stores them with the draft (vendor-files bucket, <org>/drafts/…) and Send attaches them.
--   • email_drafts.files: [{name, mime, path, size}], each path under the organization's drafts folder.
--   • email_drafts.availability_ask_id: an "ask the rep" email saved as a draft still gets its reply read once sent.
set local lock_timeout = '5s';

alter table public.email_drafts add column if not exists files jsonb not null default '[]'::jsonb;
alter table public.email_drafts drop constraint if exists email_drafts_files_array;
alter table public.email_drafts add constraint email_drafts_files_array check (jsonb_typeof(files) = 'array');
comment on column public.email_drafts.files is 'Files saved with the draft (from the computer or made by VMS): [{name, mime, path, size}] in vendor-files under <org>/drafts/ (Dana, Nov 9).';
alter table public.email_drafts add column if not exists availability_ask_id uuid references public.availability_asks(id) on delete set null;
comment on column public.email_drafts.availability_ask_id is 'An "ask the rep" email saved as a draft: Claude reads the reply once it is sent.';
