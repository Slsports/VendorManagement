-- 0280 — Policies from Hub's 2026-27 certificate pack, SJ&E Road's new Orion180 policy, the bank's policy list, and quiet
-- Paychex / Blue Shield mail (Dana, Nov 2, "go").
--   • From "COI 26-27 CGLI CUMB CWCO - Holder Pack" (Hub, Aug 11, 2026): general liability OMO4815073 and umbrella
--     XLO004815073 (National Casualty, 8/1/2026-8/1/2027; Hub's Aug 14 autopay: $62,560 + $16,993), workers' comp
--     WCC332560A (7/1), Travelers auto BA1R5085172242G (7/3), pollution PPK2309059-002 (Tokio Marine, to 8/1/2027).
--   • SJ&E Road: "I believe Orion180 replaced both" — Orion180 home policy OICDPCA_01809203 (Oct 29, 2026, $3,468.91, through
--     Goosehead); the Cal Fair and Steadily SJ&E policies are retired and their renewal tasks closed.
--   • Community West Bank's proof: the SLS building at 41777 Tollhouse (Cal Fair fire + P&S DIC), liability, umbrella,
--     workers' comp, auto, pollution, and 35775 Aunt Julia ("the bank does have an interest in our personal property on Aunt
--     Julia too … but they never ask us for it").
--   • "We sold our boat to SLSI": the Progressive boat papers go back to business insurance.
--   • "I need Blue Shield as an accounting company contact and all their emails should be filed with them. Same with
--     Paychex … I don't want vms to notify me unless they are telling me about some deadline for something I have to do."
--     One contact each (Paychex takes in the Mid Atlantic 401(k) statements, Mineral, Paychex Flex, its surveys and webinars
--     and the Zurich EPD-PayChex policy: "Paychex"). New column accounting_contacts.quiet: their conversations never wait
--     on an answer; the quiet-mail function has Claude read each new email and makes a task only for a deadline Dana must
--     meet. Back-check: waiting conversations to Handled; the last 90 days read for deadlines still ahead.
set local lock_timeout = '5s';

-- Quiet contacts -------------------------------------------------------------------------------------------------------
alter table public.accounting_contacts add column if not exists quiet boolean not null default false;
comment on column public.accounting_contacts.quiet is 'Only deadlines notify (Dana, Nov 2: Paychex, Blue Shield): their mail is filed as Handled; Claude makes a task only for a deadline she must meet.';
alter table public.emails add column if not exists deadline_read_at timestamptz;
comment on column public.emails.deadline_read_at is 'When the quiet-mail reader looked at this email for a deadline (quiet accounting contacts only).';

create or replace function public.email_threads_quiet_contact() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'waiting_on_us' and new.accounting_contact_id is not null
     and exists (select 1 from public.accounting_contacts c where c.id = new.accounting_contact_id and c.quiet) then
    new.status := 'handled';
  end if;
  return new;
end;
$$;
drop trigger if exists email_threads_quiet_contact on public.email_threads;
create trigger email_threads_quiet_contact before insert or update of status, accounting_contact_id on public.email_threads
  for each row execute function public.email_threads_quiet_contact();

-- New emails from a quiet contact, for Claude to read for a deadline (last 90 days only).
create or replace function public.quiet_deadline_queue(p_org uuid, p_limit integer default 10)
returns table (email_id uuid, contact text, from_email text, subject text, received_at timestamptz, text text)
language sql stable security definer set search_path = public as $$
  select e.id, c.company, e.from_email, e.subject, e.received_at, left(coalesce(nullif(e.body_text, ''), e.snippet, ''), 8000)
    from public.emails e
    join public.mailboxes b on b.id = e.mailbox_id and b.kind = 'accounting'
    join public.email_threads t on t.id = e.thread_id
    join public.accounting_contacts c on c.id = t.accounting_contact_id and c.quiet
   where e.organization_id = p_org and e.direction = 'in' and e.deadline_read_at is null
     and e.received_at > now() - interval '90 days'
   order by e.received_at desc
   limit p_limit
$$;
revoke execute on function public.quiet_deadline_queue(uuid, integer) from public, anon, authenticated;
grant execute on function public.quiet_deadline_queue(uuid, integer) to service_role;

-- Claude's answer: a task only for a deadline still ahead (or today) that Dana must meet.
create or replace function public.quiet_deadline_apply(p_email uuid, p_what text, p_due date) returns uuid
language plpgsql security definer set search_path = public as $$
declare e record; v_owner uuid; v_task uuid; v_contact text;
begin
  update public.emails set deadline_read_at = now() where id = p_email;
  if p_due is null or nullif(trim(coalesce(p_what, '')), '') is null or p_due < (now() at time zone 'America/Los_Angeles')::date then return null; end if;
  select em.id, em.organization_id, em.thread_id, em.subject, em.received_at into e from public.emails em where em.id = p_email;
  if e.id is null then return null; end if;
  if exists (select 1 from public.tasks t where t.organization_id = e.organization_id and t.auto_key in ('ask:' || p_email, 'deadline:' || p_email)) then return null; end if;
  select c.company into v_contact from public.email_threads t join public.accounting_contacts c on c.id = t.accounting_contact_id where t.id = e.thread_id;
  v_owner := public.accounting_owner(e.organization_id);
  if v_owner is null then return null; end if;
  insert into public.tasks (organization_id, title, notes, due_date, remind_at, remind_rule, assigned_to, created_by, thread_id, auto_key, area)
  values (e.organization_id, left(coalesce(v_contact, 'Deadline') || ': ' || trim(p_what) || ' by ' || to_char(p_due, 'Mon FMDD'), 200),
          'From "' || coalesce(e.subject, 'their email') || '" (' || to_char(e.received_at at time zone 'America/Los_Angeles', 'Mon FMDD, YYYY')
            || '). VMS reminds you now, weekly, 3 days before and on the day. Click to open the email.',
          p_due, now(), 'ask', v_owner, null, e.thread_id, 'deadline:' || p_email, 'accounting')
  on conflict (organization_id, auto_key) where auto_key is not null do nothing
  returning id into v_task;
  return v_task;
end;
$$;
revoke execute on function public.quiet_deadline_apply(uuid, text, date) from public, anon, authenticated;
grant execute on function public.quiet_deadline_apply(uuid, text, date) to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'quiet-mail';
    perform cron.schedule('quiet-mail', '*/10 * * * *',
      $job$select net.http_post(url := 'https://bpdpkytfmpbwpbmpejbf.supabase.co/functions/v1/quiet-mail', headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'mail_cron_secret')), body := '{}'::jsonb, timeout_milliseconds := 150000)$job$);
  end if;
end $$;

-- Paychex and Blue Shield: one contact each (hosted data; each step finds its rows by name) ------------------------------
create or replace function pg_temp.merge_contact(p_from uuid, p_into uuid) returns void language sql as $$
  update public.accounting_contact_addresses set contact_id = p_into where contact_id = p_from;
  update public.accounting_contacts c set message_count = c.message_count + f.message_count, last_contact_at = greatest(c.last_contact_at, f.last_contact_at)
    from public.accounting_contacts f where c.id = p_into and f.id = p_from;
  update public.accounting_contacts set status = 'ignored', merged_into = p_into where id = p_from;
  update public.email_threads set accounting_contact_id = p_into where accounting_contact_id = p_from;
$$;

select pg_temp.merge_contact(f.id, i.id)
  from public.accounting_contacts i
  join public.accounting_contacts f on f.organization_id = i.organization_id and f.id <> i.id and f.merged_into is null
       and (f.company in ('Blue Shield of CA', 'Blue Shield of California'))
 where i.company = 'Employer Connection at Blue Shield of California' and i.merged_into is null;
update public.accounting_contacts set company = 'Blue Shield of California', person = '', category = 'insurance', status = 'confirmed', quiet = true,
       role = 'Employee health insurance',
       notes = 'Employee health insurance. Quiet: their mail is filed here as Handled; VMS only makes a task for a deadline (Dana, Nov 2).'
 where company = 'Employer Connection at Blue Shield of California' and merged_into is null;

select pg_temp.merge_contact(f.id, i.id)
  from public.accounting_contacts i
  join public.accounting_contacts f on f.organization_id = i.organization_id and f.id <> i.id and f.merged_into is null
       and f.company in ('Macg', 'Mineral')
 where i.company = 'Paychex Inc.' and i.merged_into is null;
update public.accounting_contacts set company = 'Paychex', person = '', category = 'payroll', status = 'confirmed', quiet = true,
       role = 'Payroll, HR, 401(k) (Mid Atlantic statements), EPD insurance (Zurich)',
       notes = 'Payroll and HR. Includes the Mid Atlantic 401(k) statements, Mineral (handbook builder), Paychex Flex, their surveys and webinars, and the Zurich EPD-PayChex policy. Quiet: their mail is filed here as Handled; VMS only makes a task for a deadline (Dana, Nov 2).'
 where company = 'Paychex Inc.' and merged_into is null;

-- every address they use, so new mail files itself
insert into public.accounting_contact_addresses (organization_id, address, is_domain, contact_id)
select c.organization_id, v.address, v.is_domain, c.id
  from public.accounting_contacts c
  cross join (values ('Paychex', 'paychexflex.com', true), ('Paychex', 'matcpaychexsupport@macg.com', false), ('Paychex', 'matcadmin@macg.com', false),
                     ('Paychex', 'paychexhandbookbuilder@trustmineral.com', false), ('Paychex', 'noreply@trustmineral.com', false),
                     ('Paychex', 'paychex@express.sea1.medallia.com', false), ('Paychex', 'usz.paychex@zurichna.com', false),
                     ('Blue Shield of California', 'blueshieldca.com', true), ('Blue Shield of California', 'info.blueshieldca.com', true),
                     ('Blue Shield of California', 'bscaplan.com', true), ('Blue Shield of California', 'bscabook.com', true)) as v(company, address, is_domain)
 where c.company = v.company and c.merged_into is null
   and not exists (select 1 from public.accounting_contact_addresses a where a.organization_id = c.organization_id and a.address = v.address);
update public.accounting_contact_addresses a set contact_id = c.id
  from public.accounting_contacts c
 where c.organization_id = a.organization_id and c.merged_into is null and c.company = 'Paychex'
   and a.address in ('matcpaychexsupport@macg.com', 'matcadmin@macg.com', 'paychexhandbookbuilder@trustmineral.com', 'noreply@trustmineral.com',
                     'paychex@express.sea1.medallia.com', 'usz.paychex@zurichna.com', 'paychexflex.com')
   and a.contact_id <> c.id;

-- file every conversation they write in: re-match by sender, and the shared senders (webinars, surveys) by name
select public.accounting_match_thread(t.id)
  from public.email_threads t join public.mailboxes b on b.id = t.mailbox_id and b.kind = 'accounting'
 where exists (select 1 from public.emails e where e.thread_id = t.id and e.direction = 'in'
                and (e.from_email ~* '(paychex|blueshieldca|bscaplan|bscabook|@macg\.com|trustmineral|zurichna)'));
update public.email_threads t set accounting_contact_id = c.id
  from public.accounting_contacts c, public.mailboxes b
 where b.id = t.mailbox_id and b.kind = 'accounting' and c.organization_id = t.organization_id and c.company = 'Paychex' and c.merged_into is null
   and t.accounting_contact_id is null
   and exists (select 1 from public.emails e where e.thread_id = t.id and e.direction = 'in'
                and lower(e.from_email) in ('do_not_reply@on24event.com', 'noreply@qemailserver.com') and coalesce(e.from_name, '') ~* 'paychex');

-- back-check: their waiting conversations go to Handled; email older than 90 days is not read for deadlines
update public.email_threads t set status = 'handled'
  from public.accounting_contacts c
 where c.id = t.accounting_contact_id and c.quiet and t.status = 'waiting_on_us';
update public.emails e set deadline_read_at = now()
  from public.email_threads t, public.accounting_contacts c
 where t.id = e.thread_id and c.id = t.accounting_contact_id and c.quiet and e.deadline_read_at is null
   and e.received_at <= now() - interval '90 days';

-- Insurance from the certificate pack --------------------------------------------------------------------------------
update public.accounting_policies set carrier = 'National Casualty (Nationwide)', policy_number = 'OMO4815073',
       prior_policy_numbers = array['OMO0038125', 'OMO0029819'], renewal_date = date '2027-08-01',
       coverage_description = 'Commercial marine liability and liquor liability (stores, marina, General Store)',
       named_insured = 'Shaver Lake Sports Inc. DBA Happy Camper General Store, DBA Shaver Lake Marina',
       coverage_limits = '$1,000,000 each occurrence; $2,000,000 general aggregate; products $1,000,000; rented premises $100,000',
       notes = 'Required by the SCE licenses (Article 4b): SCE named as additional insured, primary, waiver of subrogation. 2026-27 (8/1/2026-8/1/2027) from Hub''s certificate pack of Aug 11, 2026; paid through Hub''s autopay Aug 14 ($62,560).'
 where coverage_type = 'liability' and label = 'Commercial general liability' and policy_number = '';
update public.accounting_policies set carrier = 'National Casualty (Nationwide)', policy_number = 'WCC332560A', renewal_date = date '2027-07-01',
       notes = 'Required by the SCE licenses (Article 4a) with waiver of subrogation. 2026-27 (7/1/2026-7/1/2027) from Hub''s certificate pack of Aug 11, 2026.'
 where coverage_type = 'workers_comp' and policy_number = '';
update public.accounting_policies set notes = notes || ' Policy BA1R5085172242G (7/3/2026-7/3/2027, from Hub''s certificate pack); 7276G0232 is the Travelers billing account.'
 where policy_number = '7276G0232' and notes not like '%BA1R5085172242G%';

insert into public.accounting_policies (organization_id, label, property, coverage_description, coverage_type, carrier, agent_contact_id, policy_number,
       prior_policy_numbers, named_insured, paid_by, coverage_limits, renewal_date, autopay, notes, is_active, sort_order, personal)
select o.id, v.label, '', v.descr, v.ctype, v.carrier,
       (select c.id from public.accounting_contacts c where c.organization_id = o.id and c.company = 'Hub International' and c.person = 'Sam Gibbs' and c.merged_into is null limit 1),
       v.number, v.prior, 'SLSI', 'SLS', v.limits, v.renewal, v.autopay, v.notes, true, v.sort, false
  from public.organizations o
  cross join (values
    ('Umbrella / excess liability', 'Over the general liability', 'umbrella', 'National Casualty (Nationwide)', 'XLO004815073', array['XLO0034574'],
     '$1,000,000 each occurrence; $1,000,000 aggregate', date '2027-08-01', true,
     '2026-27 (8/1/2026-8/1/2027) from Hub''s certificate pack of Aug 11, 2026; paid through Hub''s autopay Aug 14 ($16,993).', 21),
    ('Pollution / environmental', '', 'other', 'Tokio Marine Specialty', 'PPK2309059-002', '{}'::text[],
     '$500,000 aggregate', date '2027-08-01', false,
     'Three-year policy 8/1/2024-8/1/2027, from Hub''s certificate pack of Aug 11, 2026.', 22)
  ) as v(label, descr, ctype, carrier, number, prior, limits, renewal, autopay, notes, sort)
 where exists (select 1 from public.accounting_policies p where p.organization_id = o.id and p.policy_number = 'SL2923292')
   and not exists (select 1 from public.accounting_policies p where p.organization_id = o.id and p.policy_number = v.number);
update public.accounting_policies set autopay = true where policy_number = 'OMO4815073';

insert into public.accounting_policy_terms (organization_id, policy_id, term_label, premium, paid_on, paid_from, notes)
select p.organization_id, p.id, '2026-27', v.premium, date '2026-08-14', 'Hub autopay', 'Hub International automatic payment of $79,553 on Aug 14, 2026 (two invoices).'
  from public.accounting_policies p join (values ('OMO4815073', 62560.00), ('XLO004815073', 16993.00)) as v(number, premium) on v.number = p.policy_number
on conflict (policy_id, term_label) do nothing;
update public.autopay_schedules a set policy_id = p.id, note = 'Aug 14, 2026 paid the general liability OMO4815073 ($62,560) and the umbrella XLO004815073 ($16,993).'
  from public.accounting_policies p
 where p.organization_id = a.organization_id and p.policy_number = 'OMO4815073' and a.payee = 'Hub International';

-- the certificate pack is on file: tie it to the liability policy
update public.accounting_documents d set policy_id = p.id
  from public.accounting_policies p
 where p.organization_id = d.organization_id and p.policy_number = 'OMO4815073' and d.policy_id is null
   and d.original_name = 'COI 26-27 CGLI CUMB CWCO - Holder Pack.pdf';

-- SJ&E Road: Orion180 replaced Cal Fair and Steadily
insert into public.accounting_policies (organization_id, label, property, coverage_description, coverage_type, carrier, agent_contact_id, policy_number,
       prior_policy_numbers, named_insured, paid_by, coverage_limits, renewal_date, autopay, notes, is_active, sort_order, personal)
select o.id, 'SJ&E Road, home (Orion180)', '34484 SJ&E Road', 'Home policy: dwelling, other structures, loss of use, personal liability', 'other', 'Orion180',
       (select c.id from public.accounting_contacts c where c.organization_id = o.id and c.company = 'Goosehead' and c.merged_into is null limit 1),
       'OICDPCA_01809203', array['CFP 0102402240 00', 'SP3-CA-21323788-00'], 'Gregory Powell, Dana Powell', '',
       'Dwelling $410,000 (replacement cost); other structures $8,200; loss of use $41,000; personal liability $500,000; deductible $2,500',
       date '2027-10-29', false,
       'New business Oct 29, 2026 through Goosehead (David Wagner), replacing the Cal Fair fire and Steadily wrap on SJ&E (Dana, Nov 2). Mortgagee: Nationstar Mortgage. Renewal date from the invoice date.',
       true, 34, true
  from public.organizations o
 where exists (select 1 from public.accounting_policies p where p.organization_id = o.id and p.policy_number = 'SL2923292')
   and not exists (select 1 from public.accounting_policies p where p.organization_id = o.id and p.policy_number = 'OICDPCA_01809203');
insert into public.accounting_policy_terms (organization_id, policy_id, term_label, premium, paid_on, paid_from)
select p.organization_id, p.id, '2026-27', 3468.91, date '2026-10-29', '' from public.accounting_policies p where p.policy_number = 'OICDPCA_01809203'
on conflict (policy_id, term_label) do nothing;
update public.accounting_documents d set category = 'personal_insurance', party = 'Orion180', policy_id = p.id
  from public.accounting_policies p
 where p.organization_id = d.organization_id and p.policy_number = 'OICDPCA_01809203' and d.number = 'OICDPCA_01809203';
update public.accounting_policies set is_active = false,
       notes = notes || ' Replaced by Orion180 OICDPCA_01809203 on Oct 29, 2026 (Dana, Nov 2).'
 where policy_number in ('CFP 0102402240 00', 'SP3-CA-21323788-00') and is_active;
update public.tasks t set done_at = now(), closed_how = 'request',
       done_note = 'Closed at Dana''s request: Orion180 replaced this SJ&E policy on Oct 29, 2026 (Dana, Nov 2).'
  from public.accounting_policies p
 where p.id = t.policy_id and p.policy_number in ('CFP 0102402240 00', 'SP3-CA-21323788-00') and t.done_at is null and t.auto_key like 'policy_renewal:%';

-- The boat went to SLSI: its Progressive papers are business insurance again.
update public.accounting_documents set category = 'insurance' where category = 'personal_insurance' and number = '959231577';

-- Community West Bank: which policies it needs
update public.accounting_policy_recipients r set policy_ids = array(
         select p.id from public.accounting_policies p
          where p.organization_id = r.organization_id and p.is_active
            and (p.policy_number in ('OMO4815073', 'XLO004815073', 'WCC332560A', '7276G0232', 'PPK2309059-002', 'COM 0301476591 02', 'SL2923291',
                                     'CFP 0100341142', 'BSNH3-2023-105727-01'))),
       notes = 'Was Central Valley Community Bank. Needs: the SLS building at 41777 Tollhouse (owned by P&S: Cal Fair fire and the P&S DIC), liability, umbrella, workers'' comp, auto, pollution, and 35775 Aunt Julia Lane (the bank has an interest in it but never asks; Dana, Nov 2). Hub''s 2026-27 certificate pack (Aug 11, 2026) is in Documents.'
 where r.send_how ilike '%myinsuranceinfo%';
update public.tasks t set thread_id = coalesce((select e.thread_id from public.accounting_documents d join public.emails e on e.id = d.email_id
                                                 where d.organization_id = t.organization_id and d.original_name = 'COI 26-27 CGLI CUMB CWCO - Holder Pack.pdf' limit 1), t.thread_id),
       notes = 'Commercial loan. Upload it at myinsuranceinfo.com: Hub''s 2026-27 certificate pack (click to open Shelly''s Aug 11 email with it), the property evidence for the SLS building at 41777 Tollhouse, and the 35775 Aunt Julia policies. Their confirmation email marks it sent.'
 where t.done_at is null and t.auto_key like 'proof_due:%'
   and t.recipient_id in (select r.id from public.accounting_policy_recipients r where r.send_how ilike '%myinsuranceinfo%');
