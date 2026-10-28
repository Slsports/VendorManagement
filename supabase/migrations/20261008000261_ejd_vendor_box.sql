-- 0261 — Stihl or EJD comes from the "Vendor:" box only (Dana, Oct 28): Stihl invoice 9689012976 was tagged EJD because
-- Emery Jensen's name is at the top of every paper, Stihl's dropship invoices included; the Stihl part is the box
-- "Vendor: 39394 PACIFIC STIHL". Dana: "vms can only look at the part that says Vendor". Only Stihl is split out; any other Vendor box (Midwest Fasteners) or none = EJD.
-- Every EJ paper read so far is read again (the reader now reads only that box).

set local lock_timeout = '5s';

comment on column public.vendor_links.billed_as is 'Who the paper is billed for, from its "Vendor:" box only ("Stihl" on an Emery Jensen dropship invoice; "EJD" when there is no Vendor box) (Dana, Oct 28).';

update public.vendor_links l set billed_as = null, billcom_read_at = null
  from public.vendors v
 where v.id = l.vendor_id and v.billcom_check and l.kind in ('invoice', 'credit') and l.billcom_read_at is not null;
