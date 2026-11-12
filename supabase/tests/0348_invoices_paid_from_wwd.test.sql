-- An invoice is Paid from WWD's paid date for the same vendor and number, when WWD gets paid later and when the number is
-- read later; another vendor's WWD invoice with the same number does not count.
begin;
select '00000000-0000-0000-0000-000000000001'::uuid as org \gset
insert into public.vendors (organization_id, name) values (:'org', 'WWD Pay Test A') returning id as va \gset
insert into public.vendors (organization_id, name) values (:'org', 'WWD Pay Test B') returning id as vb \gset
insert into public.wwd_invoices (organization_id, seq, kind, vendor_id, vendor_invoice_number, paid_date) values
  (:'org', 'S348A', 'invoice', :'va', '0034801', '2026-03-13'),
  (:'org', 'S348B', 'invoice', :'vb', '34802', '2026-03-14');
insert into public.wwd_invoices (organization_id, seq, kind, vendor_id, vendor_invoice_number) values (:'org', 'S348C', 'invoice', :'va', '34803') returning id as w_later \gset
-- A: paid already; B's number on A's paper; A: paid later; A: number read later
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, doc_number) values
  (:'org', :'va', 'invoice', 'a1', 'x/a1.pdf', '34801') returning id as l1 \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, doc_number) values
  (:'org', :'va', 'invoice', 'a2', 'x/a2.pdf', '34802') returning id as l2 \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, doc_number) values
  (:'org', :'va', 'invoice', 'a3', 'x/a3.pdf', '34803') returning id as l3 \gset
update public.wwd_invoices set paid_date = '2026-04-01' where id = :'w_later';
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path) values
  (:'org', :'vb', 'invoice', 'b1', 'x/b1.pdf') returning id as l4 \gset
update public.vendor_links set doc_number = '34802' where id = :'l4';
select set_config('t.l1', :'l1', false), set_config('t.l2', :'l2', false), set_config('t.l3', :'l3', false), set_config('t.l4', :'l4', false);
do $$ begin
  if (select paid_at::text || ' ' || paid_how from public.vendor_links where id = current_setting('t.l1')::uuid) is distinct from '2026-03-13 WWD (invoice S348A)' then raise exception 'paid on file: wrong'; end if;
  if (select paid_at from public.vendor_links where id = current_setting('t.l2')::uuid) is not null then raise exception 'another vendor''s WWD invoice counted'; end if;
  if (select paid_at from public.vendor_links where id = current_setting('t.l3')::uuid) is distinct from '2026-04-01' then raise exception 'paid later: not marked'; end if;
  if (select paid_at from public.vendor_links where id = current_setting('t.l4')::uuid) is distinct from '2026-03-14' then raise exception 'number read later: not marked'; end if;
end $$;
rollback;
