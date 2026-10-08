-- 0049 — Bulk import of historical vendor documents (Dana, Oct 8): whole vendor folders from Dropbox are
-- dropped on VMS, sorted by vendor, folder and year (from the folder names, else Claude reads the file),
-- reviewed by a person, then filed. Imported documents say so (source 'import', the original path in notes).
alter table public.vendor_links drop constraint if exists vendor_links_source_check;
alter table public.vendor_links add constraint vendor_links_source_check check (source in ('manual', 'rep_list', 'email', 'vendor_form', 'import'));
