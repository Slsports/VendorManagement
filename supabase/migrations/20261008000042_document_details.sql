-- 0063 — Scanned paper invoices (Dana, Oct 9): Claude reads each document's number, date and total; they are
-- kept on the document so old invoices can be found by number or amount, and the date sets the year folder.
alter table public.vendor_links add column if not exists doc_number text;
alter table public.vendor_links add column if not exists doc_date date;
alter table public.vendor_links add column if not exists doc_total numeric(12,2);
comment on column public.vendor_links.doc_number is 'Invoice, credit memo or packing slip number read from the document.';
create index if not exists vendor_links_doc_number_idx on public.vendor_links (organization_id, upper(doc_number)) where doc_number is not null;
