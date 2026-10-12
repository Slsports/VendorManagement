-- 0097 — Moves teach everyone (Dana, Oct 12: "if one of us moves something to Promotions we would all want it in
-- Promotions"). One rule per address and kind of mail for the whole store, whichever inbox it was taught in; the
-- newest move wins. mailbox_id now only records a move made in someone's own inbox, so that rule (and the address
-- in it) stays visible to that person and the admin only.

delete from public.mail_address_rules r
 using public.mail_address_rules newer
 where newer.organization_id = r.organization_id and newer.address = r.address and newer.mail_kind = r.mail_kind
   and (newer.created_at, newer.id) > (r.created_at, r.id);
drop index if exists public.mail_address_rules_key;
create unique index if not exists mail_address_rules_key on public.mail_address_rules (organization_id, address, mail_kind);
comment on table public.mail_address_rules is 'Where one kind of mail from one address goes (Primary = attention, Promotions = offers), taught by anyone moving a conversation; applies to every inbox. mailbox_id set = taught in that personal inbox, so only its owner and the admin can read the rule.';

create or replace function public.mail_address_rule(p_org uuid, p_mailbox uuid, p_from text, p_kind text)
returns text language sql stable security definer set search_path = public as $$
  select r.view from public.mail_address_rules r
   where r.organization_id = p_org and r.address = lower(p_from) and r.mail_kind = p_kind
   limit 1
$$;

create or replace function public.set_email_thread_view(p_thread uuid, p_view text, p_teach boolean default true)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  t       public.email_threads%rowtype;
  v_ids   uuid[];
  v_moved integer := 0;
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
    insert into public.mail_address_rules (organization_id, mailbox_id, address, mail_kind, view, created_by)
    select distinct t.organization_id, case when t.shared_at is null then t.mailbox_id end, lower(e.from_email),
           public.mail_email_kind(e.labels, e.subject, e.is_bulk), p_view, auth.uid()
      from public.emails e
     where e.thread_id = p_thread and e.direction = 'in' and coalesce(e.from_email, '') <> ''
    on conflict (organization_id, address, mail_kind)
    do update set view = excluded.view, mailbox_id = excluded.mailbox_id, created_by = excluded.created_by, created_at = now();

    -- the same addresses' mail in every inbox follows
    select array_agg(o.id) into v_ids
      from public.emails o
     where o.organization_id = t.organization_id and o.thread_id <> p_thread and o.direction = 'in'
       and lower(o.from_email) in (select lower(from_email) from public.emails where thread_id = p_thread and direction = 'in');
    if v_ids is not null then
      v_moved := public.mail_classify(t.organization_id, v_ids);
    end if;
  end if;
  return coalesce(v_moved, 0);
end;
$$;
