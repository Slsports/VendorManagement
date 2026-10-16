-- 0113 — Accounting area, step 1 (Dana, Oct 16; docs/accounting-plan.md). Dana's bookkeeping mail (billing@, moved into
-- Workspace from billing.slsports@gmail.com) is a mailbox of kind 'accounting'. Only people with profiles.sees_accounting
-- see it, its conversations, emails and attachments; being admin is not enough, and it is never shared to Orders.
-- Dana has the tick; Settings → Users lets the admin tick one more person without making them admin.

alter table public.profiles add column if not exists sees_accounting boolean not null default false;
comment on column public.profiles.sees_accounting is 'Sees the Accounting area (billing@ mail, bills, accounting tasks). Admin alone is not enough. Admins set it.';

-- Dana: the first admin of each organization.
update public.profiles p set sees_accounting = true
 where p.id = (select id from public.profiles q where q.organization_id = p.organization_id and q.role = 'admin' and q.is_active order by q.created_at limit 1);

create or replace function public.sees_accounting() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.sees_accounting from public.profiles p where p.id = auth.uid() and p.is_active), false)
$$;
revoke execute on function public.sees_accounting() from public, anon;
grant execute on function public.sees_accounting() to authenticated, service_role;

-- Only admins change the ticks (sees_accounting joins role, active, email and places_orders; sees_freight was open).
create or replace function public.protect_profile_privileged_columns()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id then
    raise exception 'A profile cannot be moved to another organization' using errcode = '42501';
  end if;

  -- Service role / SQL editor (no JWT subject) may change anything else.
  if auth.uid() is null then
    return new;
  end if;

  if not public.is_admin() then
    if new.role      is distinct from old.role
    or new.is_active is distinct from old.is_active
    or new.email     is distinct from old.email
    or new.places_orders is distinct from old.places_orders
    or new.sees_freight is distinct from old.sees_freight
    or new.sees_accounting is distinct from old.sees_accounting then
      raise exception 'Only administrators can change role, active status, email or what a person sees' using errcode = '42501';
    end if;
  elsif new.id = auth.uid()
    and (new.role is distinct from old.role or new.is_active is distinct from old.is_active) then
    raise exception 'Administrators cannot change their own role or deactivate themselves' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- The accounting mailbox kind.
alter table public.mailboxes drop constraint if exists mailboxes_kind_check;
alter table public.mailboxes add constraint mailboxes_kind_check check (kind in ('personal', 'legacy', 'accounting'));
comment on column public.mailboxes.kind is 'personal: synced as that person. legacy: the old Gmail, arrives in orders@. accounting: billing@, synced like personal, seen only with profiles.sees_accounting.';

-- Who may see a mailbox's mail: its owner and the admin; the accounting mailbox only people with the tick.
create or replace function public.can_see_mailbox(p_mailbox uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.mailboxes m
     where m.id = p_mailbox and public.user_in_org(m.organization_id)
       and case when m.kind = 'accounting' then public.sees_accounting() else (m.owner_id = auth.uid() or public.is_admin()) end
  )
$$;

drop policy if exists "mailboxes: owner and admin read" on public.mailboxes;
create policy "mailboxes: owner and admin read" on public.mailboxes for select to authenticated
  using (public.user_in_org(organization_id)
         and case when kind = 'accounting' then public.sees_accounting() else (owner_id = auth.uid() or public.is_admin()) end);

-- Accounting mail is never shared to Orders (no share_thread_to_orders, no auto-share).
create or replace function public.email_threads_accounting_private() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.shared_at is not null and new.mailbox_id is not null
     and exists (select 1 from public.mailboxes m where m.id = new.mailbox_id and m.kind = 'accounting') then
    raise exception 'Accounting mail stays private; it cannot be shared to Orders' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists email_threads_accounting_private on public.email_threads;
create trigger email_threads_accounting_private before insert or update of shared_at, mailbox_id on public.email_threads
  for each row execute function public.email_threads_accounting_private();
