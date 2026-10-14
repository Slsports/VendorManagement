-- 0107 — Tasks take you to the work (Dana, Oct 14: "There should be something there that I can click on that takes me to
-- what I need to do"; "If the system already knows what order its for I should land right there"). The screens map each
-- task to its place; this adds what they need:
-- • "I paid it" on a pay-by task (WWD early-pay discount, order terms, freight back): the bill is marked paid now and the
--   task is done; the payment import adds the payment number later.
-- • The Edenred and Bill.com pay pages, opened from a pay-by task.
-- • Claude's best guess at the order for a confirmation it could not match, picked in advance on the check page.

alter table public.organizations add column if not exists edenred_url text;
alter table public.organizations add column if not exists billcom_url text default 'https://app.bill.com';
alter table public.order_checks add column if not exists suggested_order_id uuid references public.orders(id) on delete set null;
comment on column public.order_checks.suggested_order_id is 'Claude''s best guess at the order when it was not sure enough to match it (picked in advance on the check page).';

-- "I paid it": the bill behind a pay-by task is paid (today, unless it already has a date) and the task is done. Admin.
create or replace function public.task_mark_paid(p_task uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  t   public.tasks%rowtype;
  v_id uuid;
begin
  select * into t from public.tasks where id = p_task;
  if t.id is null or not public.user_in_org(t.organization_id) then raise exception 'Task not found' using errcode = '23503'; end if;
  if not public.is_admin() then raise exception 'Only the admin marks bills paid' using errcode = '42501'; end if;
  if t.auto_key like 'wwd:%' then
    v_id := split_part(t.auto_key, ':', 2)::uuid;
    update public.wwd_invoices set sheet_paid_date = coalesce(sheet_paid_date, current_date),
           note = concat_ws(' · ', note, 'Marked paid in VMS ' || to_char(current_date, 'FMMM/FMDD/YY'))
     where id = v_id and organization_id = t.organization_id and paid_date is null and sheet_paid_date is null;
  elsif t.auto_key like 'order:%' then
    v_id := split_part(t.auto_key, ':', 2)::uuid;
    update public.orders set paid_date = coalesce(paid_date, current_date)
     where id = v_id and organization_id = t.organization_id;
  else
    raise exception 'This task is not a bill to pay' using errcode = '22023';
  end if;
  update public.tasks set done_at = now(), done_by = auth.uid(), done_note = 'Paid' where id = p_task and done_at is null;
end;
$$;
revoke execute on function public.task_mark_paid(uuid) from public, anon;
grant execute on function public.task_mark_paid(uuid) to authenticated, service_role;

-- The admin saves the pay pages' addresses (Settings, or the first time from a pay-by task).
create or replace function public.org_set_pay_links(p_org uuid, p_edenred text, p_billcom text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_admin() and public.user_in_org(p_org)) then raise exception 'Only the admin changes this' using errcode = '42501'; end if;
  if coalesce(p_edenred, '') !~* '^(https://\S+)?$' or coalesce(p_billcom, '') !~* '^(https://\S+)?$' then raise exception 'Use a web address starting with https://' using errcode = '22023'; end if;
  update public.organizations set edenred_url = coalesce(nullif(trim(p_edenred), ''), edenred_url), billcom_url = coalesce(nullif(trim(p_billcom), ''), billcom_url) where id = p_org;
end;
$$;
revoke execute on function public.org_set_pay_links(uuid, text, text) from public, anon;
grant execute on function public.org_set_pay_links(uuid, text, text) to authenticated;
