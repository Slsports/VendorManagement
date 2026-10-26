-- 0246 — Dropbox read: lines and freight (Dana, Oct 26, after the first readings). Most "vendor not found" papers were
-- about lines (catalog-only names in vendor_directory: Sock It To Me, Top Trenz, Youzey …), which VMS never turns into
-- vendors unless promoted; a line's papers go under the line (vendor_links.line_id). A freight carrier's bill goes to
-- Freight: when a bill in VMS is waiting for that PDF (needs_pdf, same invoice number) the file fills it and is read;
-- else it waits on Dana's list. Worldwide's own paperwork (payment sheets, exports) is never filed under a vendor.
alter table public.dropbox_files add column if not exists line_id uuid references public.vendor_directory(id) on delete set null;
alter table public.dropbox_files add column if not exists freight_bill_id uuid references public.freight_bills(id) on delete set null;
alter table public.dropbox_files drop constraint if exists dropbox_files_target_check;
alter table public.dropbox_files add constraint dropbox_files_target_check check (target in ('vendor', 'line', 'freight', 'accounting', 'skip'));
