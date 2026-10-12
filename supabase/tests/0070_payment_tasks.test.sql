\set ON_ERROR_STOP on
\pset footer off
\echo '>>> Pay-by tasks: best discount still open, next tier when it passes, closed when paid'
reset role;
select id as admin_id from public.profiles where organization_id = '00000000-0000-0000-0000-000000000001' and role = 'admin' and is_active order by created_at limit 1 \gset
select (array_agg(pct order by days))::text as pcts, (array_agg(days order by days))::text as days from public.pay_terms_tiers('6%30,4%60,3%90,NET91');
select public.pay_terms_net('2% 30 / NET 90') as net, public.pay_terms_net('4%/30 2%/60 NET/90') as net2;
insert into public.vendors (organization_id, name) values ('00000000-0000-0000-0000-000000000001', 'Pay Tasks Vendor') returning id as v \gset
insert into public.wwd_invoices (organization_id, seq, kind, vendor_id, vendor_invoice_date, amount, terms)
values ('00000000-0000-0000-0000-000000000001', 'PT-1', 'invoice', :'v', current_date - 10, 1000, '4%/30 2%/60 NET/90') returning id as w \gset
select public.sync_payment_tasks('00000000-0000-0000-0000-000000000001') as made;
select due_date = current_date + 20 as first_tier, title like '%for 4% off ($40.00)%' as says_4pct, assigned_to = :'admin_id' as to_admin
from public.tasks where auto_key = 'wwd:' || :'w' || ':30';
-- the 30-day date passes unpaid: the 2% tier takes over
update public.wwd_invoices set vendor_invoice_date = current_date - 40 where id = :'w';
select public.sync_payment_tasks('00000000-0000-0000-0000-000000000001') is not null as synced;
select (select done_note from public.tasks where auto_key = 'wwd:' || :'w' || ':30') as old_tier,
       (select title like '%for 2% off%' from public.tasks where auto_key = 'wwd:' || :'w' || ':60' and done_at is null) as next_tier;
-- paid: closed
update public.wwd_invoices set paid_date = current_date where id = :'w';
select public.sync_payment_tasks('00000000-0000-0000-0000-000000000001') is not null as synced_again;
select done_note from public.tasks where auto_key = 'wwd:' || :'w' || ':60';
-- freight back
insert into public.orders (organization_id, vendor_id, status, freight_allowance_offered, freight_allowance, freight_allowance_pay_by)
values ('00000000-0000-0000-0000-000000000001', :'v', 'entered', true, 55, current_date + 3) returning id as o \gset
select public.sync_payment_tasks('00000000-0000-0000-0000-000000000001') is not null as synced_freight;
select title like '%to get the freight back ($55.00)' as freight_title, remind_at <= now() + interval '1 minute' as remind_now from public.tasks where auto_key = 'order:' || :'o' || ':freight';
delete from public.tasks where vendor_id = :'v';
delete from public.orders where id = :'o';
delete from public.wwd_invoices where id = :'w';
delete from public.vendors where id = :'v';
