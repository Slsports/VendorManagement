-- Dana, Nov 10: "check his unanswered mail against the orders email. He may have handled something through orders@ that
-- started in his jarrett@". When orders@ sends a reply in a conversation with the same subject (Re:/Fwd: aside) and vendor
-- as a conversation waiting on us in a staff mailbox, that staff conversation is handled. Back-check below.
create or replace function public.thread_norm_subject(p_subject text) returns text
language sql immutable as $$ select regexp_replace(lower(coalesce(p_subject, '')), '^(\s*(re|fwd?|fw)\s*:\s*)+', '') $$;

create or replace function public.staff_threads_handled_via_orders(p_org uuid, p_email uuid default null) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with o as (
    select t.id, t.vendor_id, public.thread_norm_subject(t.subject) as norm, e.received_at as replied_at
      from public.emails e join public.email_threads t on t.id = e.thread_id
     where e.organization_id = p_org and e.direction = 'out' and e.mailbox_id is null and e.copy_of is null
       and (p_email is null or e.id = p_email)
  )
  update public.email_threads t set status = 'handled'
    from o, public.mailboxes m
   where t.organization_id = p_org and t.mailbox_id = m.id and m.kind = 'personal' and t.deleted_at is null
     and t.status = 'waiting_on_us' and t.id <> o.id
     and public.thread_norm_subject(t.subject) = o.norm and o.norm <> ''
     and (t.vendor_id = o.vendor_id or t.vendor_id is null or o.vendor_id is null)
     and o.replied_at >= t.last_message_at - interval '1 day';
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.staff_threads_handled_via_orders(uuid, uuid) from public, anon, authenticated;
grant execute on function public.staff_threads_handled_via_orders(uuid, uuid) to service_role;

create or replace function public.emails_staff_threads_handled() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.direction = 'out' and new.mailbox_id is null and new.copy_of is null then
    perform public.staff_threads_handled_via_orders(new.organization_id, new.id);
  end if;
  return new;
end $$;
drop trigger if exists emails_staff_threads_handled on public.emails;
create trigger emails_staff_threads_handled after insert on public.emails for each row execute function public.emails_staff_threads_handled();

do $$ declare o record; n integer; begin
  for o in select id from public.organizations where is_active loop
    n := public.staff_threads_handled_via_orders(o.id);
    raise notice 'staff conversations handled through orders@: %', n;
  end loop;
end $$;
