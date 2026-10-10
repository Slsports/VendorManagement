-- 0073 — A change made in VMS survives a re-import of the Placed Order Summary (Dana, Oct 10: "make the import
-- keep VMS dates"). Every order field the sheet also carries remembers when someone changed it in VMS
-- (edited_fields); while an import runs (it sets vms.import = on) those fields keep their VMS value.
alter table public.orders add column if not exists edited_fields text[] not null default '{}';

create or replace function public.orders_keep_vms_edits() returns trigger
language plpgsql set search_path = public as $$
declare
  tracked constant text[] := array['status', 'order_date', 'placed_by', 'store_codes', 'billing_route', 'description', 'est_ship_date', 'est_cost',
    'freight_cost', 'freight_notes', 'date_received', 'po_number', 'ar_due', 'ar_due_date', 'date_entered_ls', 'entered_by', 'backorder',
    'shipment_notes', 'credits_due', 'credit_notes', 'date_credits_received', 'ok_to_pay', 'notes', 'final_cost', 'paid_date', 'paid_via', 'paid_ref'];
  o jsonb := to_jsonb(old);
  n jsonb;
begin
  if coalesce(current_setting('vms.import', true), '') = 'on' then
    if cardinality(old.edited_fields) > 0 then
      new := jsonb_populate_record(new, (select jsonb_object_agg(k, o->k) from unnest(old.edited_fields) k where o ? k));
    end if;
    return new;
  end if;
  n := to_jsonb(new);
  new.edited_fields := array(select distinct x from unnest(old.edited_fields || array(
    select k from unnest(tracked) k where n->k is distinct from o->k)) x order by 1);
  return new;
end;
$$;
drop trigger if exists orders_keep_vms_edits on public.orders;
create trigger orders_keep_vms_edits before update on public.orders for each row execute function public.orders_keep_vms_edits();

-- The dates fixed on Oct 10 (Scope PO 1132, World Famous PO B671437) count as VMS changes. (Run with the import
-- flag so the trigger leaves edited_fields as set here.)
select set_config('vms.import', 'on', true);
update public.orders set edited_fields = array(select distinct x from unnest(edited_fields || array['order_date']) x)
 where extra ? 'Date fixed (Dana, Oct 10)';
