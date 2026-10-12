-- 0098 — Dana has the last say (Oct 12: "I want the last say in where it goes"). A move teaches everyone, but a rule
-- the admin set is only changed by the admin. Anyone else's move still moves that one conversation. Between the
-- others, the newest move wins. Returns how many other emails moved, or -1 when the admin's rule kept the rest.
create or replace function public.set_email_thread_view(p_thread uuid, p_view text, p_teach boolean default true)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  t       public.email_threads%rowtype;
  v_ids   uuid[];
  v_moved integer := 0;
  v_kept  boolean := false;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers sort mail'; end if;
  if p_view not in ('attention', 'offers') then raise exception 'Unknown view %', p_view; end if;
  select * into t from public.email_threads where id = p_thread;
  if not found or not public.user_in_org(t.organization_id)
     or not (t.mailbox_id is null or t.shared_at is not null or public.can_see_mailbox(t.mailbox_id)) then
    raise exception 'Conversation not found';
  end if;

  update public.emails set view = p_view, view_how = 'manual' where thread_id = p_thread and direction = 'in';
  update public.email_threads set view = p_view where id = p_thread;
  if p_teach then
    -- the admin's earlier rule for one of these addresses, pointing the other way, stays
    select exists (
      select 1 from public.mail_address_rules r join public.profiles p on p.id = r.created_by and p.role = 'admin'
        join public.emails e on e.thread_id = p_thread and e.direction = 'in' and lower(e.from_email) = r.address
       where r.organization_id = t.organization_id and r.view <> p_view
    ) and not public.is_admin() into v_kept;

    insert into public.mail_address_rules (organization_id, mailbox_id, address, mail_kind, view, created_by)
    select distinct t.organization_id, case when t.shared_at is null then t.mailbox_id end, lower(e.from_email),
           public.mail_email_kind(e.labels, e.subject, e.is_bulk), p_view, auth.uid()
      from public.emails e
     where e.thread_id = p_thread and e.direction = 'in' and coalesce(e.from_email, '') <> ''
    on conflict (organization_id, address, mail_kind)
    do update set view = excluded.view, mailbox_id = excluded.mailbox_id, created_by = excluded.created_by, created_at = now()
     where public.is_admin()
        or not exists (select 1 from public.profiles p where p.id = mail_address_rules.created_by and p.role = 'admin');

    -- the same addresses' mail in every inbox follows the rules as they now stand
    select array_agg(o.id) into v_ids
      from public.emails o
     where o.organization_id = t.organization_id and o.thread_id <> p_thread and o.direction = 'in'
       and lower(o.from_email) in (select lower(from_email) from public.emails where thread_id = p_thread and direction = 'in');
    if v_ids is not null then
      v_moved := public.mail_classify(t.organization_id, v_ids);
    end if;
  end if;
  return case when v_kept then -1 else coalesce(v_moved, 0) end;
end;
$$;
