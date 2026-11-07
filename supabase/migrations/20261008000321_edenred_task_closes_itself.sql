-- 0321 — An Edenred task closes itself once its files are filed (Dana, Nov 7: "I will always want a task closed when the
-- items have been completed, whether I mark it or vms does").
-- The "Edenred: … VMS couldn't place" task stayed open after the Strike King and Mechanix Wear invoices were filed on Nov 3.
--   • edenred_unplaced_files(email): the PDFs in that Edenred email still waiting — not filed to a vendor, not made a
--     freight bill, and marked by the Edenred reader as "no WWD invoice found" / "WWD invoice has no vendor yet".
--   • edenred_task_close(email): when none are left, its open task is closed by VMS with a plain note naming where the
--     files went (closed_how 'vms').
--   • A file filed to a vendor (email_attachments.vendor_link_id set) or made a freight bill runs the check for its email.
--   • Back-check: every open Edenred task is checked now.
set local lock_timeout = '5s';

create or replace function public.edenred_unplaced_files(p_email uuid)
returns table (id uuid, file_name text, mime_type text, gmail_attachment_id text, note text)
language sql stable security definer set search_path = public as $$
  select a.id, a.file_name, a.mime_type, a.gmail_attachment_id, a.accounting_skip
    from public.email_attachments a join public.emails e on e.id = a.email_id
   where a.email_id = p_email
     and (auth.uid() is null or public.user_in_org(e.organization_id))
     and a.vendor_link_id is null
     and a.accounting_skip in ('Edenred: no WWD invoice found', 'Edenred: WWD invoice has no vendor yet')
     and not exists (select 1 from public.freight_bills b where b.source_attachment_id = a.id)
   order by a.file_name
$$;
revoke execute on function public.edenred_unplaced_files(uuid) from public, anon;
grant execute on function public.edenred_unplaced_files(uuid) to authenticated, service_role;

create or replace function public.edenred_task_close(p_email uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare v_where text; n integer;
begin
  if exists (select 1 from public.edenred_unplaced_files(p_email)) then return 0; end if;
  select string_agg(distinct v.name, ', ' order by v.name) into v_where
    from public.email_attachments a join public.vendor_links l on l.id = a.vendor_link_id join public.vendors v on v.id = l.vendor_id
   where a.email_id = p_email and a.accounting_skip in ('Edenred: no WWD invoice found', 'Edenred: WWD invoice has no vendor yet');
  update public.tasks set done_at = now(), closed_how = 'vms',
         done_note = 'VMS closed it: every file VMS couldn''t place in this Edenred email is now filed'
                     || coalesce(' (' || v_where || ')', '') || '.'
   where auto_key = 'edenred:' || p_email and done_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.edenred_task_close(uuid) from public, anon;
grant execute on function public.edenred_task_close(uuid) to service_role;

create or replace function public.edenred_task_close_on_file() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.tasks where auto_key = 'edenred:' || new.email_id and done_at is null) then
    perform public.edenred_task_close(new.email_id);
  end if;
  return null;
end;
$$;
revoke execute on function public.edenred_task_close_on_file() from public, anon;
drop trigger if exists email_attachments_edenred_task on public.email_attachments;
create trigger email_attachments_edenred_task after update of vendor_link_id on public.email_attachments
  for each row when (new.vendor_link_id is not null and old.vendor_link_id is distinct from new.vendor_link_id)
  execute function public.edenred_task_close_on_file();

create or replace function public.edenred_task_close_on_freight() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_email uuid;
begin
  select email_id into v_email from public.email_attachments where id = new.source_attachment_id;
  if v_email is not null then perform public.edenred_task_close(v_email); end if;
  return null;
end;
$$;
revoke execute on function public.edenred_task_close_on_freight() from public, anon;
drop trigger if exists freight_bills_edenred_task on public.freight_bills;
create trigger freight_bills_edenred_task after insert or update of source_attachment_id on public.freight_bills
  for each row when (new.source_attachment_id is not null)
  execute function public.edenred_task_close_on_freight();

-- Back-check: every open Edenred task now
select coalesce(sum(public.edenred_task_close(split_part(auto_key, ':', 2)::uuid)), 0) as edenred_tasks_closed
  from public.tasks where auto_key like 'edenred:%' and done_at is null;
