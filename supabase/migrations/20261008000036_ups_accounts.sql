-- 0057 — Our UPS account number through each billing company (Dana, Oct 8), shown on the Freight bills
-- page so bills never get mixed up. "Account with them" (WWEX's W0003290195) is a different number.
--   UPS DIRECT 89787W   our own UPS account, no longer used (WWEX prices UPS much better)
--   PartnerShip V513K4  used earlier in 2026; WWEX beats their pricing
--   WWEX 2K229F         the default UPS (parcel) shipper
alter table public.carriers add column if not exists ups_account text;
alter table public.carriers add column if not exists is_default_parcel boolean not null default false;
comment on column public.carriers.ups_account is 'Our UPS account number through this billing company (shown on the Freight bills page).';
create unique index if not exists carriers_one_default_parcel on public.carriers (organization_id) where is_default_parcel;

insert into public.carriers (organization_id, name, mode, email_domains, ups_account, owner_id, notes)
select o.id, 'UPS DIRECT', 'parcel', '{}', '89787W',
       (select owner_id from public.carriers c where c.organization_id = o.id and c.name = 'PartnerShip'),
       'Our own UPS account. No longer used for new shipments: Worldwide Express prices UPS much better. Old invoices are history.'
  from public.organizations o
 where exists (select 1 from public.mail_accounts m where m.organization_id = o.id)
on conflict (organization_id, name) do nothing;
update public.carriers set ups_account = 'V513K4',
       notes = coalesce(notes || ' ', '') || 'Used for UPS earlier in 2026; WWEX beats their pricing.'
 where name = 'PartnerShip' and ups_account is null;
update public.carriers set ups_account = '2K229F', is_default_parcel = true
 where name = 'Worldwide Express (ShipStation)' and ups_account is null;
