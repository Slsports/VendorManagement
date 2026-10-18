-- 175: invoices and Create PO tasks go to Trevor (Dana, Oct 18): "From shipping, matching invoice to order confirmation
-- to creating a po in ls, that should be Trevor … If he has a question on an invoice he will call me or Jarrett (whoever
-- placed the order)". Confirmations (and their Unavailable items cards) stay with whoever placed the order.
-- The person is a setting (profiles.handles_logistics, Trevor today), not a name in the code. Only what VMS assigns on
-- its own changes: a check or task someone hands to a person by hand stays with that person.

alter table public.profiles add column if not exists handles_logistics boolean not null default false;
comment on column public.profiles.handles_logistics is 'Gets invoice checks and Create PO tasks (Dana, Oct 18: Trevor, inventory and logistics).';
update public.profiles set handles_logistics = true where is_active and full_name ilike 'Trevor%';

/** Who handles logistics (invoices, Create PO): the profile with handles_logistics, else null. */
create or replace function public.logistics_person(p_org uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.profiles where organization_id = p_org and handles_logistics and is_active order by created_at limit 1
$$;
revoke execute on function public.logistics_person(uuid) from public, anon;
grant execute on function public.logistics_person(uuid) to authenticated, service_role;

-- An invoice check VMS assigns (no signed-in person behind it) goes to logistics.
create or replace function public.invoice_check_to_logistics()
returns trigger language plpgsql security definer set search_path = public as $$
declare who uuid;
begin
  if new.kind <> 'invoice' or new.assigned_to is null or auth.uid() is not null then return new; end if;
  if tg_op = 'UPDATE' and new.assigned_to is not distinct from old.assigned_to then return new; end if;
  who := public.logistics_person(new.organization_id);
  if who is not null then new.assigned_to := who; end if;
  return new;
end;
$$;
drop trigger if exists order_checks_invoice_to_logistics on public.order_checks;
create trigger order_checks_invoice_to_logistics before insert or update of assigned_to on public.order_checks
  for each row execute function public.invoice_check_to_logistics();

-- A Create PO task VMS makes goes to logistics.
create or replace function public.po_task_to_logistics()
returns trigger language plpgsql security definer set search_path = public as $$
declare who uuid;
begin
  if coalesce(new.auto_key, '') not like 'create_po:%' or auth.uid() is not null then return new; end if;
  who := public.logistics_person(new.organization_id);
  if who is not null then new.assigned_to := who; end if;
  return new;
end;
$$;
drop trigger if exists tasks_po_to_logistics on public.tasks;
create trigger tasks_po_to_logistics before insert on public.tasks
  for each row execute function public.po_task_to_logistics();

-- back-check: open invoice checks and open Create PO tasks that VMS gave to whoever placed the order
do $$
declare n_checks integer; n_tasks integer;
begin
  update public.order_checks c set assigned_to = public.logistics_person(c.organization_id), assigned_at = now()
   where c.kind = 'invoice' and c.status not in ('done', 'dismissed') and public.logistics_person(c.organization_id) is not null
     and c.assigned_to is distinct from public.logistics_person(c.organization_id)
     and (c.order_id is null or c.assigned_to is null or c.assigned_to = public.order_reviewer(c.order_id)
          or c.assigned_to = public.org_admin(c.organization_id));
  get diagnostics n_checks = row_count;
  update public.tasks t set assigned_to = public.logistics_person(t.organization_id)
   where t.auto_key like 'create_po:%' and t.done_at is null and public.logistics_person(t.organization_id) is not null
     and t.assigned_to is distinct from public.logistics_person(t.organization_id);
  get diagnostics n_tasks = row_count;
  raise notice 'invoice checks moved: %, Create PO tasks moved: %', n_checks, n_tasks;
end $$;
