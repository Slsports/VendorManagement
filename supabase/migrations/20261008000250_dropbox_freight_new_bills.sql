-- 0250 — Dropbox read: a carrier's bill with no bill waiting in VMS becomes a new freight bill (Dana, Oct 27: "it clearly
-- has the vendor listed in this freight bill"). The carrier is matched by name; the bill is read the way a dropped PDF
-- is, so its shipments land on the vendors that shipped them (the Freight page and the vendor's Freight box).
alter table public.dropbox_files add column if not exists carrier_id uuid references public.carriers(id) on delete set null;
