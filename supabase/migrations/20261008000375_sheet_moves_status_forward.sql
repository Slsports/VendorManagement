-- 0375 — The order sheet may move a status forward even when VMS set it (Nov 13, loading Dana's Nov 8 Placed Order Summary:
-- six orders Trevor entered in LS, with his entered date already in VMS, stayed Received because VMS had set Received
-- itself). A field changed in VMS still keeps its VMS value on a reload (Oct 9), except a status the sheet moves further
-- along (Sent → … → Received → Entered → Ready to pay → Paid). Going back is never allowed.
set local lock_timeout = '5s';

create or replace function public.orders_keep_vms_edits() returns trigger
language plpgsql set search_path = public as $$
declare
  tracked constant text[] := array['status', 'order_date', 'placed_by', 'store_codes', 'billing_route', 'description', 'est_ship_date', 'est_cost',
    'freight_cost', 'freight_notes', 'date_received', 'po_number', 'ar_due', 'ar_due_date', 'date_entered_ls', 'entered_by', 'backorder',
    'shipment_notes', 'credits_due', 'credit_notes', 'date_credits_received', 'ok_to_pay', 'notes', 'final_cost', 'paid_date', 'paid_via', 'paid_ref'];
  v_rank constant text[] := array['open', 'awaiting_confirmation', 'confirmed', 'shipped', 'received', 'entered', 'ready_to_pay', 'paid'];
  o jsonb := to_jsonb(old);
  n jsonb;
  v_forward boolean;
begin
  if coalesce(current_setting('vms.import', true), '') = 'on' then
    if cardinality(old.edited_fields) > 0 then
      v_forward := coalesce(array_position(v_rank, new.status::text), 0) > coalesce(array_position(v_rank, old.status::text), 0)
                   and old.status <> 'cancelled';
      new := jsonb_populate_record(new, (select jsonb_object_agg(k, o->k) from unnest(old.edited_fields) k
                                          where o ? k and not (k = 'status' and v_forward)));
    end if;
    return new;
  end if;
  n := to_jsonb(new);
  new.edited_fields := array(select distinct x from unnest(old.edited_fields || array(
    select k from unnest(tracked) k where n->k is distinct from o->k)) x order by 1);
  return new;
end;
$$;
