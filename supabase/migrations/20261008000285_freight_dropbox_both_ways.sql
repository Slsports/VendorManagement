-- 0285 — Freight bill PDFs both ways between VMS and Dropbox (Dana, Nov 2): "If I upload a freight invoice to vms can it copy
-- it to my dropbox under 1-A Shaver Lake Sports/Freight/<vendor>" … "if trevor downloads them and then uploads to vms, my
-- dropbox would not get those. So I would like it to work both ways, VMS to Dropbox and Dropbox to VMS" … "you are good to
-- go on all of it".
--   • Dropbox → VMS: the Freight folder is watched on its own (its own cursor) even though the rest of Dropbox was a one-time
--     history read; a new freight bill there is read and filed by itself when Claude is sure.
--   • VMS → Dropbox: a freight bill whose PDF is in VMS but not in Dropbox is copied to Freight/<the carrier's folder>, named
--     like Dana's ("PS00626515 PartnerShip Invoice 10-12-26.pdf"); a file already in Dropbox (same bytes) is linked, never
--     copied again; UPS goes by year (Freight/UPS/2026).
set local lock_timeout = '5s';

alter table public.carriers add column if not exists dropbox_folder text;
comment on column public.carriers.dropbox_folder is 'Folder under Freight/ in Dropbox for this carrier''s bills ({year} becomes the bill''s year). Null: the carrier''s name.';
update public.carriers set dropbox_folder = v.folder
  from (values ('PartnerShip', 'PartnerShip'), ('UPS', 'UPS/{year}'), ('FedEx', 'FedEx'), ('XPO', 'XPO'),
               ('Priority One', 'Pinnacle-Priority 1'), ('Worldwide Express (ShipStation)', 'SHIP STATION - WWEX GROUP')) as v(name, folder)
 where carriers.name = v.name and carriers.dropbox_folder is null;

alter table public.freight_bills add column if not exists dropbox_path text;
comment on column public.freight_bills.dropbox_path is 'Where this bill''s PDF is in Dropbox (copied there by VMS, or read from there).';

alter table public.dropbox_connections add column if not exists watch_freight boolean not null default true;
alter table public.dropbox_connections add column if not exists freight_cursor text;
comment on column public.dropbox_connections.watch_freight is 'Freight bills both ways: new files in <folder>/Freight come into VMS, and VMS copies its freight PDFs there.';

-- bills that came from Dropbox already have their place there
update public.freight_bills b set dropbox_path = f.path_display
  from public.dropbox_files f
 where f.freight_bill_id = b.id and f.status in ('filed', 'linked') and b.dropbox_path is null;

alter table public.dropbox_files add column if not exists from_watch boolean not null default false;
comment on column public.dropbox_files.from_watch is 'Found by the Freight folder watch (new since it started): filed by itself when Claude is sure.';
