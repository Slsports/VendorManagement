-- 0295 — The WWD weekly upload (Dana, Nov 3: "We need a set process for doing these WWD and EdenRed uploads. I want to hand
--   this to Trevor and he can do it weekly. We need a place in vms where he uploads it and then vms automatically does what
--   you are doing now to match up things. I need it done at least weekly." — "go on the weekly process").
--   * One place: Payments › WWD weekly upload (the WWD box). Each upload is logged (wwd_uploads).
--   * After an upload VMS does the follow-up on its own: the Edenred invoice files in orders@ that were waiting on a WWD
--     number or a vendor are read again (and a freight bill sent through WWD becomes a freight bill: gmail-sync); WWD names
--     that are on the WWD portal list can be added as a vendor with one click (wwd_name_add_vendor).
--   * Every Monday the person set to do it (Trevor) gets "WWD weekly upload"; it closes itself when an upload is done that
--     week. Not done by Wednesday 9 AM: the admin gets a task saying so.
set local lock_timeout = '5s';

create table if not exists public.wwd_uploads (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  uploaded_by     uuid references public.profiles(id) on delete set null,
  uploaded_at     timestamptz not null default now(),
  kinds           text[] not null default '{}',
  files           text[] not null default '{}',
  result          jsonb not null default '{}'::jsonb
);
create index if not exists wwd_uploads_org_at on public.wwd_uploads (organization_id, uploaded_at desc);
alter table public.wwd_uploads enable row level security;
drop policy if exists "wwd_uploads: members read" on public.wwd_uploads;
create policy "wwd_uploads: members read" on public.wwd_uploads for select to authenticated using (public.user_in_org(organization_id));
grant select on table public.wwd_uploads to authenticated;
grant all on table public.wwd_uploads to service_role;

-- who does the weekly upload (Dana: Trevor)
alter table public.organizations add column if not exists wwd_upload_by uuid references public.profiles(id) on delete set null;
update public.organizations o set wwd_upload_by = p.id
  from public.profiles p
 where p.organization_id = o.id and p.full_name = 'Trevor' and p.is_active and o.wwd_upload_by is null;

-- the Monday start of this week in the store's time
create or replace function public.wwd_week_start(p_at timestamptz default now()) returns date
language sql stable set search_path = '' as $$
  select (date_trunc('week', (p_at at time zone 'America/Los_Angeles')))::date
$$;

-- After the upload's files are imported: log it, queue the waiting Edenred files, close this week's tasks.
create or replace function public.wwd_upload_done(p_kinds text[], p_files text[], p_result jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid := public.current_user_org();
  v_me   uuid := auth.uid();
  v_who  text;
  n_att  integer;
  n_mail integer;
  n_names integer;
  n_portal integer;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers import WWD payments' using errcode = '42501'; end if;
  insert into public.wwd_uploads (organization_id, uploaded_by, kinds, files, result)
  values (v_org, v_me, coalesce(p_kinds, '{}'), coalesce(p_files, '{}'), coalesce(p_result, '{}'::jsonb));

  -- Edenred files left in an email because their WWD invoice or vendor wasn't in VMS yet: the mail sync reads them again
  with t as (
    select a.id, a.email_id from public.email_attachments a join public.emails e on e.id = a.email_id
     where e.organization_id = v_org and e.from_email ilike '%@edenredpayinvoice.com' and e.mailbox_id is null
       and a.vendor_link_id is null and a.accounting_skip in ('Edenred: no WWD invoice found', 'Edenred: WWD invoice has no vendor yet')
  ), u as (update public.email_attachments a set accounting_skip = null from t where a.id = t.id returning a.email_id)
  select count(*), count(distinct email_id) into n_att, n_mail from u;
  update public.emails set paper_scanned_at = null
   where id in (select a.email_id from public.email_attachments a join public.emails e on e.id = a.email_id
                 where e.organization_id = v_org and e.from_email ilike '%@edenredpayinvoice.com' and e.mailbox_id is null
                   and a.vendor_link_id is null and a.accounting_skip is null and a.file_name ilike '%.pdf');

  -- WWD names still without a vendor, and how many of them the WWD portal list knows
  select count(distinct upper(trim(w.wwd_vendor_name))),
         count(distinct upper(trim(w.wwd_vendor_name))) filter (where exists (
           select 1 from public.wwd_portal_vendors p where p.organization_id = v_org and p.vendor_id is null
              and public.payee_key(p.name) = public.payee_key(w.wwd_vendor_name)))
    into n_names, n_portal
    from public.wwd_invoices w
   where w.organization_id = v_org and w.vendor_id is null and w.carrier_id is null and w.wwd_vendor_name is not null;

  -- this week's tasks are done
  select coalesce(full_name, 'someone') into v_who from public.profiles where id = v_me;
  update public.tasks set done_at = now(), done_note = left(format('Closed by VMS: the WWD weekly upload was done %s by %s.',
           to_char(now() at time zone 'America/Los_Angeles', 'Mon DD, YYYY'), coalesce(v_who, 'someone')), 500)
   where organization_id = v_org and done_at is null
     and auto_key in ('wwdweekly:' || public.wwd_week_start(), 'wwdweekly_late:' || public.wwd_week_start());

  return jsonb_build_object('files_to_read', n_att, 'emails_to_read', n_mail, 'names_to_match', n_names, 'names_on_portal', n_portal);
end;
$$;
revoke execute on function public.wwd_upload_done(text[], text[], jsonb) from public, anon;
grant execute on function public.wwd_upload_done(text[], text[], jsonb) to authenticated, service_role;

-- WWD names (among p_names) that are on the WWD portal list and not a vendor yet: "Add as new vendor"
create or replace function public.wwd_names_on_portal(p_names text[]) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct n), '{}') from unnest(p_names) n
   where exists (select 1 from public.wwd_portal_vendors p where p.organization_id = public.current_user_org() and p.vendor_id is null
                   and public.payee_key(p.name) = public.payee_key(n))
$$;
revoke execute on function public.wwd_names_on_portal(text[]) from public, anon;
grant execute on function public.wwd_names_on_portal(text[]) to authenticated, service_role;

-- "Add as new vendor": the WWD portal's line becomes a WWD vendor with the portal's details, and the name's invoices follow
create or replace function public.wwd_name_add_vendor(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.current_user_org();
  p     public.wwd_portal_vendors%rowtype;
  v_id  uuid;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers add vendors' using errcode = '42501'; end if;
  select * into p from public.wwd_portal_vendors w
   where w.organization_id = v_org and w.vendor_id is null and public.payee_key(w.name) = public.payee_key(p_name)
   order by w.read_at desc nulls last limit 1;
  if p.id is null then raise exception '% is not on the WWD portal list in VMS. Use Pick vendor, or add the vendor first.', p_name using errcode = '22023'; end if;
  if p.line_id is not null then
    v_id := public.promote_line_to_vendor(p.line_id, 'worldwide'::public.billing_route);
  else
    insert into public.vendors (organization_id, name) values (v_org, p.name) returning id into v_id;
    update public.wwd_portal_vendors set vendor_id = v_id where id = p.id;
  end if;
  update public.wwd_portal_vendors set vendor_id = v_id where id = p.id and vendor_id is null;
  perform public.wwd_portal_apply(p.id);
  perform public.wwd_assign_name(p_name, v_id);
  return v_id;
end;
$$;
revoke execute on function public.wwd_name_add_vendor(text) from public, anon;
grant execute on function public.wwd_name_add_vendor(text) to authenticated, service_role;

-- Monday: the task; Wednesday 9 AM with no upload: the admin hears about it. Hourly.
create or replace function public.wwd_weekly_tasks() returns integer
language plpgsql security definer set search_path = public as $$
declare
  o      record;
  wk     date := public.wwd_week_start();
  local  timestamp := now() at time zone 'America/Los_Angeles';
  n      integer := 0;
  done   boolean;
  admin  uuid;
begin
  for o in select id, wwd_upload_by from public.organizations where wwd_upload_by is not null loop
    done := exists (select 1 from public.wwd_uploads u where u.organization_id = o.id and u.uploaded_at >= (wk::timestamp at time zone 'America/Los_Angeles'));
    if not done then
      insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, area, auto_key)
      values (o.id, 'WWD weekly upload',
              'Download this week''s files and drop them all in Payments › WWD weekly upload, then click Import: '
              || '1) WWD Payment History export, 2) the Edenred invoice export (Select all columns; from the day after the last upload), '
              || '3) Dana''s WWD payment sheet(s) if there are new ones, 4) WWD''s Payments Due list. VMS matches everything and closes this task. '
              || 'See Help: "Do the WWD weekly upload".',
              wk, (wk + time '08:00') at time zone 'America/Los_Angeles', o.wwd_upload_by, 'general', 'wwdweekly:' || wk)
      on conflict (organization_id, auto_key) where auto_key is not null do nothing;
      if found then n := n + 1; end if;
      if local >= (wk + 2) + time '09:00' then
        admin := public.org_admin(o.id);
        if admin is not null and admin <> o.wwd_upload_by then
          insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, area, auto_key)
          values (o.id, 'The WWD weekly upload is not done yet this week',
                  format('Nobody has done the WWD weekly upload since Monday %s. It is on %s''s tasks. This closes itself when it is done.',
                         to_char(wk, 'Mon DD'), coalesce((select full_name from public.profiles where id = o.wwd_upload_by), 'the person set to do it')),
                  wk + 2, now(), admin, 'general', 'wwdweekly_late:' || wk)
          on conflict (organization_id, auto_key) where auto_key is not null do nothing;
          if found then n := n + 1; end if;
        end if;
      end if;
    end if;
  end loop;
  return n;
end;
$$;
revoke execute on function public.wwd_weekly_tasks() from public, anon, authenticated;
grant execute on function public.wwd_weekly_tasks() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'wwd-weekly';
    perform cron.schedule('wwd-weekly', '7 * * * *', 'select public.wwd_weekly_tasks()');
  end if;
end $$;

-- Dana and Claude did this week's upload today (Nov 3): logged, so this week's task starts done
insert into public.wwd_uploads (organization_id, uploaded_by, kinds, files, result)
select o.id, null, array['sheet', 'due', 'edenred_lines'],
       array['11-3-26 WORLDWIDE PAYMENT 9672.85.xlsx', '11-3-26 WORLDWIDE FUTURE PAYMENTS DUE.xlsx', 'Edenred Invoice Export 10-20-26 to 11-3-26.xlsx'],
       '{"note": "Loaded by Claude for Dana, Nov 3, 2026"}'::jsonb
  from public.organizations o where o.wwd_upload_by is not null;
