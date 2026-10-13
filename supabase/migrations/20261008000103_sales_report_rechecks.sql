-- 0103 — A sales report filed or ticked re-checks the vendor's waiting confirmations (Dana, Oct 13: "will it notice I
-- have uploaded a sales report that needs to be compared to the confirmation Dom sent?"). Confirmations from the last
-- 6 months still open (to review, or no order found) that had no order, no item list ("the order record only"), or an
-- unticked report go back to Claude to compare with the report.
create or replace function public.sales_report_recheck() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind <> 'sales_report' or new.storage_path is null or new.vendor_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.report_used_at is not distinct from old.report_used_at and new.storage_path is not distinct from old.storage_path then return new; end if;
  update public.order_checks set status = 'comparing', working_at = null, report_id = null, report_ticked = null
   where vendor_id = new.vendor_id and kind = 'confirmation' and reading is not null
     and created_at > now() - interval '180 days'
     and (status = 'needs_order'
          or (status = 'to_review' and (order_id is null or against like 'The order record only%' or (report_id is not null and report_ticked is not true))));
  return new;
end;
$$;
drop trigger if exists vendor_links_sales_report_recheck on public.vendor_links;
create trigger vendor_links_sales_report_recheck after insert or update of report_used_at, storage_path on public.vendor_links
  for each row execute function public.sales_report_recheck();
