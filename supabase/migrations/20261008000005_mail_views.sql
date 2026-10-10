-- 0026 — Mail views (docs/orders-and-mail-plan.md §1): "Needs attention" and "Offers & catalogs", like
-- Outlook's Focused and Other, plus "Everything". Anything VMS is unsure about stays in Needs attention.
-- How it sorts, in order: a person's answer for the sender; conversations we are part of; order, invoice
-- and shipping words; Gmail's Promotions tab; bulk-mail marks (List-Unsubscribe) and offer words.
-- Moving a conversation teaches VMS that sender (email_senders.view_rule) and moves its other mail too.
-- A Claude read of the unclear ones comes once the organization has an API key.

alter table public.emails add column if not exists view text not null default 'attention' check (view in ('attention', 'offers'));
alter table public.emails add column if not exists view_how text check (view_how in ('gmail', 'signals', 'rule', 'read', 'manual'));
alter table public.emails add column if not exists is_bulk boolean;       -- List-Unsubscribe / Precedence: bulk; null = not read yet
comment on column public.emails.view is 'Needs attention or Offers & catalogs. view_how: gmail (Promotions tab), signals (headers and words), rule (taught by a move), read (Claude), manual (moved by a person).';
alter table public.email_threads add column if not exists view text not null default 'attention' check (view in ('attention', 'offers'));
create index if not exists email_threads_view_idx on public.email_threads (organization_id, view, last_message_at desc);
alter table public.email_senders add column if not exists view_rule text check (view_rule in ('attention', 'offers'));
comment on column public.email_senders.view_rule is 'Where this sender''s mail goes, taught by moving a conversation. Null = sort each email.';

-- Words that mean someone has to act: orders, invoices, shipping, payments, returns. These win over offer signals.
create or replace function public.mail_is_transactional(p_subject text)
returns boolean language sql immutable as $$
  select coalesce(p_subject, '') ~* '(^\s*(re|aw|sv)\s*:)|order\s*(#|no\.?|number|confirm|update|received|status|has been)|\mconfirmation|\minvoice|\mstatement|\mshipped|\mshipment|\mdeliver(y|ed)|tracking|\mpayment|\mreceipt|credit memo|\mreturn auth|\mRMA\M|back ?order|purchase order|\mPO\M|past due|remittance|\mquote\M|estimate|routing|\mRA\s*#'
$$;

create or replace function public.mail_is_offerish(p_subject text)
returns boolean language sql immutable as $$
  select coalesce(p_subject, '') ~* 'special|\msale\M|catalog|price ?list|new arrivals?|new products?|product alert|trending|close ?outs?|clearance|lookbook|\mpromo|% ?off|discount|newsletter|webinar|introducing|just (in|landed)|now available|pre-?book|show (special|deal|program)|deadline approaching|limited time|best ?sellers?|sourcing'
$$;

-- One email's view. Returns {view, how}.
create or replace function public.mail_view_for(p_direction text, p_labels text[], p_subject text, p_from text, p_is_bulk boolean, p_rule text, p_conversation boolean)
returns text[] language sql immutable as $$
  select case
    when p_direction <> 'in' then array['attention', 'signals']
    when p_rule is not null then array[p_rule, 'rule']
    when p_conversation then array['attention', 'signals']
    when public.mail_is_transactional(p_subject) then array['attention', 'signals']
    when 'CATEGORY_PROMOTIONS' = any (p_labels) then array['offers', 'gmail']
    when coalesce(p_is_bulk, false) then array['offers', 'signals']
    when public.mail_is_offerish(p_subject) then array['offers', 'signals']
    else array['attention', 'signals']
  end
$$;

-- Sort emails (the given ones, or every one in the organization) and then their conversations. Leaves
-- what a person moved by hand alone. Returns how many emails changed view.
create or replace function public.mail_classify(p_org uuid, p_ids uuid[] default null)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare v_changed integer;
begin
  with target as (
    select e.id,
           public.mail_view_for(e.direction, e.labels, e.subject, e.from_email, e.is_bulk, s.view_rule,
             exists (select 1 from public.emails o where o.thread_id = e.thread_id and o.direction = 'out')) as vh
      from public.emails e left join public.email_senders s on s.id = e.sender_id
     where e.organization_id = p_org and (p_ids is null or e.id = any (p_ids)) and e.view_how is distinct from 'manual'
  ), upd as (
    update public.emails e set view = t.vh[1], view_how = t.vh[2]
      from target t where e.id = t.id and (e.view is distinct from t.vh[1] or e.view_how is distinct from t.vh[2])
    returning e.id, e.thread_id
  )
  select count(*) into v_changed from upd;

  -- A conversation is an offer only when nothing in it went out and every message that came in is an offer.
  update public.email_threads th set view = x.v
    from (
      select t.id, case when bool_and(e.direction = 'in' and e.view = 'offers') filter (where e.direction <> 'internal') then 'offers' else 'attention' end as v
        from public.email_threads t join public.emails e on e.thread_id = t.id
       where t.organization_id = p_org
         and (p_ids is null or t.id in (select thread_id from public.emails where id = any (p_ids)))
       group by t.id
    ) x
   where th.id = x.id and th.view is distinct from x.v;
  return v_changed;
end;
$$;

-- The sync read the bulk-mail headers of older emails: store them and re-sort those emails. Service role only.
create or replace function public.mail_set_bulk(p_org uuid, p_ids uuid[], p_bulk boolean[])
returns integer
language plpgsql security definer
set search_path = public
as $$
begin
  update public.emails e set is_bulk = x.b
    from unnest(p_ids, p_bulk) as x(id, b)
   where e.id = x.id and e.organization_id = p_org;
  return public.mail_classify(p_org, p_ids);
end;
$$;

-- A person moves a conversation. Its incoming mail is marked by hand; with p_teach (the default) the
-- senders learn the view and their other mail moves too. Returns how many other emails moved.
create or replace function public.set_email_thread_view(p_thread uuid, p_view text, p_teach boolean default true)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  t         public.email_threads%rowtype;
  v_senders uuid[];
  v_moved   integer := 0;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers sort mail'; end if;
  if p_view not in ('attention', 'offers') then raise exception 'Unknown view %', p_view; end if;
  select * into t from public.email_threads where id = p_thread;
  if not found or not public.user_in_org(t.organization_id) then raise exception 'Conversation not found'; end if;

  update public.emails set view = p_view, view_how = 'manual' where thread_id = p_thread and direction = 'in';
  update public.email_threads set view = p_view where id = p_thread;
  if p_teach then
    select array_agg(distinct sender_id) into v_senders from public.emails where thread_id = p_thread and direction = 'in' and sender_id is not null;
    if v_senders is not null then
      update public.email_senders set view_rule = p_view where id = any (v_senders);
      select public.mail_classify(t.organization_id, array_agg(id)) into v_moved
        from public.emails where sender_id = any (v_senders) and thread_id <> p_thread;
    end if;
  end if;
  return coalesce(v_moved, 0);
end;
$$;

-- Settings > Mail "Re-sort all mail". Admins only.
create or replace function public.mail_reclassify_all(p_org uuid)
returns integer
language plpgsql security definer
set search_path = public
as $$
begin
  if not (public.is_admin() and public.user_in_org(p_org)) then raise exception 'Only admins re-sort all mail'; end if;
  return public.mail_classify(p_org, null);
end;
$$;

-- New mail is sorted as it lands: mail_process now ends with mail_classify.
create or replace function public.mail_process(p_org uuid, p_email_ids uuid[], p_backfill boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  r        record;
  v_linked integer := 0;
begin
  for r in select id from public.emails where organization_id = p_org and id = any (p_email_ids) order by received_at loop
    if public.mail_link_email(r.id) then v_linked := v_linked + 1; end if;
  end loop;
  for r in select distinct thread_id from public.emails where id = any (p_email_ids) loop
    perform public.mail_refresh_thread(r.thread_id, p_backfill);
  end loop;
  for r in select distinct e.sender_id from public.emails e join public.email_senders s on s.id = e.sender_id
            where e.id = any (p_email_ids) and s.kind = 'unknown' loop
    perform public.mail_refresh_sender(r.sender_id);
  end loop;
  perform public.mail_classify(p_org, p_email_ids);
  return jsonb_build_object('linked', v_linked);
end;
$$;

revoke execute on function public.mail_classify(uuid, uuid[]), public.mail_set_bulk(uuid, uuid[], boolean[]) from public, anon, authenticated;
grant execute on function public.mail_classify(uuid, uuid[]), public.mail_set_bulk(uuid, uuid[], boolean[]) to service_role;
grant execute on function public.mail_is_transactional(text), public.mail_is_offerish(text), public.mail_view_for(text, text[], text, text, boolean, text, boolean) to authenticated, service_role;
revoke execute on function public.set_email_thread_view(uuid, text, boolean), public.mail_reclassify_all(uuid) from public, anon;
grant execute on function public.set_email_thread_view(uuid, text, boolean), public.mail_reclassify_all(uuid) to authenticated, service_role;

-- Sort what is already here with what is known now (Gmail tabs, subjects). Bulk-mail headers of these
-- older emails are read by the sync over the next half hour and re-sort them as they come in.
select public.mail_classify(o.id, null) from public.organizations o where exists (select 1 from public.emails e where e.organization_id = o.id);
