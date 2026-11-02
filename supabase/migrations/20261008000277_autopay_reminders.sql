-- 0277 — Autopay and scheduled payment reminders (Dana, Nov 2): "even if something is on autopay it should notify me …
-- so I can make sure the bank account has enough cash … I need reminders 5 days ahead of any auto pays." And: "our
-- accountant puts some on auto pay but he would email me … they can be stretched out over several months so its easy
-- for me to forget when one scheduled 6 months ago is going to go through. Any notifications from MBS Accountancy or the
-- IRS or FTB." CDTFA is paid by hand and already has its own reminders (cdtfa tasks), so it is left out here.
--   • The billing@ mail from MBS Accountancy, the IRS and the FTB, and any "scheduled / automatic payment" email, is read
--     by Claude (autopay-read, every 10 minutes), with the PDF it carries (MBS's cover letter with the year's estimated
--     payments): each payment with a date still to come becomes a task "Autopay <date>: <who> $<amount> (<what>)" or
--     "Pay by <date>: …", reminded 5 days before, opening the email it came from. The same payment from two emails is one.
--   • Back-check: the last 13 months of that mail (tasks only for payments still to come).

set local lock_timeout = '5s';

alter table public.emails add column if not exists autopay_read_at timestamptz, add column if not exists autopay_error text;

create table if not exists public.autopay_payments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email_id        uuid references public.emails(id) on delete set null,
  payee           text not null,
  what            text,
  pay_on          date not null,
  amount          numeric(12,2),
  automatic       boolean not null default true,
  dedupe_key      text not null,
  task_id         uuid references public.tasks(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (organization_id, dedupe_key)
);
comment on table public.autopay_payments is 'Scheduled and automatic payments read from the billing@ mail (Dana, Nov 2), each with its 5-days-ahead reminder task.';
alter table public.autopay_payments enable row level security;
drop policy if exists autopay_payments_read on public.autopay_payments;
create policy autopay_payments_read on public.autopay_payments for select to authenticated using (public.user_in_org(organization_id) and public.sees_accounting());
grant select on public.autopay_payments to authenticated;
grant all on public.autopay_payments to service_role;

-- the mail to read: billing@, from MBS / IRS / FTB or about a scheduled or automatic payment
create or replace function public.autopay_queue(p_org uuid, p_limit integer default 4)
returns table (email_id uuid, gmail_id text, gmail_box text, from_email text, subject text, received_at timestamptz, text text, pdfs jsonb)
language sql stable security definer set search_path = public as $$
  select e.id, e.gmail_id, e.gmail_box, e.from_email, e.subject, e.received_at, left(coalesce(e.body_text, ''), 12000),
         case when (coalesce(e.subject, '') || ' ' || left(coalesce(e.body_text, ''), 4000)) ~* '(estimat|schedul|voucher|cover letter|withdraw|installment|payment)'
              then coalesce((select jsonb_agg(jsonb_build_object('file_name', a.file_name, 'gmail_attachment_id', a.gmail_attachment_id))
                               from public.email_attachments a
                              where a.email_id = e.id and a.gmail_attachment_id is not null and coalesce(a.size, 0) <= 5000000
                                and (a.mime_type ilike '%pdf%' or a.file_name ilike '%.pdf')), '[]'::jsonb)
              else '[]'::jsonb end
    from public.emails e
    join public.mailboxes b on b.id = e.mailbox_id and b.kind = 'accounting'
   where e.organization_id = p_org and e.direction = 'in' and e.copy_of is null and e.autopay_read_at is null
     and e.received_at > now() - interval '13 months'
     and coalesce(e.from_email, '') !~* '^(marketing|newsletter|news|no-?reply-marketing)@'
     and coalesce(e.from_email, '') !~* 'cdtfa'
     and ((coalesce(e.from_email, '') ~* '(mbs\.cpa|mbsaccountancy\.com|irs\.gov|ftb\.ca\.gov)'
           and coalesce(e.subject, '') !~* '(password|login|log in|sign.?in|newsletter|webinar|in review)')
          or coalesce(e.subject, '') ~* '(scheduled (payment|transaction)|automatic payment|auto ?pay|payment scheduled|estimated tax)')
   order by e.received_at desc
   limit p_limit
$$;

-- Claude's reading: one task per payment still to come, reminded 5 days before; the same payment twice is one
create or replace function public.autopay_apply(p_email uuid, p_items jsonb, p_error text default null) returns integer
language plpgsql security definer set search_path = public as $$
declare
  e record; it jsonb; v_on date; v_amt numeric; v_payee text; v_what text; v_auto boolean; v_key text; v_id uuid; v_task uuid;
  v_owner uuid; n integer := 0; v_title text;
begin
  select id, organization_id, subject, received_at, thread_id into e from public.emails where id = p_email;
  if e.id is null then return 0; end if;
  update public.emails set autopay_read_at = now(), autopay_error = p_error where id = p_email;
  v_owner := public.accounting_owner(e.organization_id);
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_on := case when it->>'date' ~ '^\d{4}-\d{2}-\d{2}$' then (it->>'date')::date end;
    v_payee := nullif(trim(it->>'payee'), '');
    if v_on is null or v_payee is null or v_payee ~* 'cdtfa' then continue; end if;
    v_amt := case when jsonb_typeof(it->'amount') = 'number' then round((it->>'amount')::numeric, 2) end;
    v_what := nullif(trim(it->>'what'), '');
    v_auto := coalesce((it->>'automatic')::boolean, true);
    v_key := lower(regexp_replace(v_payee, '[^A-Za-z0-9]', '', 'g')) || ':' || v_on || ':' || coalesce(v_amt::text, '');
    insert into public.autopay_payments (organization_id, email_id, payee, what, pay_on, amount, automatic, dedupe_key)
    values (e.organization_id, e.id, v_payee, v_what, v_on, v_amt, v_auto, v_key)
    on conflict (organization_id, dedupe_key) do update set automatic = autopay_payments.automatic or excluded.automatic
    returning id, task_id into v_id, v_task;
    if v_task is not null or v_on < (now() at time zone 'America/Los_Angeles')::date or v_owner is null then continue; end if;
    v_title := left(case when v_auto then 'Autopay ' || to_char(v_on, 'Mon FMDD') else 'Pay by ' || to_char(v_on, 'Mon FMDD') end || ': ' || v_payee
               || coalesce(' $' || to_char(v_amt, 'FM999,999,990.00'), '') || coalesce(' (' || v_what || ')', ''), 200);
    insert into public.tasks (organization_id, title, notes, due_date, remind_at, assigned_to, auto_key, area, thread_id)
    values (e.organization_id, v_title,
            concat_ws(' ',
              case when v_auto then 'Comes out automatically on ' || to_char(v_on, 'Mon FMDD, YYYY') || '. Make sure the bank account covers it.'
                   else 'Due ' || to_char(v_on, 'Mon FMDD, YYYY') || '.' end,
              'From "' || coalesce(e.subject, 'an email') || '" (' || to_char(e.received_at at time zone 'America/Los_Angeles', 'Mon FMDD, YYYY') || '). Click to open it.'),
            v_on, greatest(now(), ((v_on - 5)::timestamp + time '09:00') at time zone 'America/Los_Angeles'), v_owner, 'autopay:' || v_id, 'accounting', e.thread_id)
    on conflict (organization_id, auto_key) where auto_key is not null do nothing
    returning id into v_task;
    if v_task is not null then
      update public.autopay_payments set task_id = v_task where id = v_id;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;
revoke execute on function public.autopay_queue(uuid, integer), public.autopay_apply(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.autopay_queue(uuid, integer), public.autopay_apply(uuid, jsonb, text) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'autopay-read';
    perform cron.schedule('autopay-read', '*/10 * * * *',
      $job$select net.http_post(url := 'https://bpdpkytfmpbwpbmpejbf.supabase.co/functions/v1/autopay-read', headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mail_cron_secret')), body := '{}'::jsonb, timeout_milliseconds := 150000)$job$);
  end if;
end $$;
