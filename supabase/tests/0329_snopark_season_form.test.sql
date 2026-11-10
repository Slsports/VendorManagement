-- A season can hold the State's form file for the year.
begin;
select '00000000-0000-0000-0000-000000000001'::uuid as org \gset
insert into public.vendors (organization_id, name) values (:'org', 'CA SNOW PARK 0329') returning id as v \gset
insert into public.vendor_links (organization_id, vendor_id, kind, label, storage_path, file_name) values (:'org', :'v', 'snopark_form', '03 - OHV 54SP 2026-2027', 'x/form.xlsx', 'form.xlsx') returning id as f \gset
insert into public.snopark_seasons (organization_id, vendor_id, label, first_report_month, season_end, final_due, form_link_id)
values (:'org', :'v', '2099-2100', '2099-11-01', '2100-05-30', '2100-06-20', :'f') returning id as s \gset
do $$ begin
  if (select form_link_id from public.snopark_seasons where label = '2099-2100') is null then raise exception 'form not kept'; end if;
end $$;
rollback;
