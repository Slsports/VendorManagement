-- 0212 — Proofs: only the version we approved gets the star, and proofs belong to their order (Dana, Oct 20: "Sometimes
-- we go back and forth a few times before deciding on the final"; go on "star only the approved proof" and "the order
-- link").
--   • When a conversation's artwork is approved, the proof(s) in the vendor's latest email with proofs before our OK get
--     the star; earlier versions in that conversation are marked "earlier version, not used" and their tasks close.
--   • A proof is tied to its order: the order of the confirmation or paper in the same email, else of the conversation,
--     else the vendor's one open order. A confirmation tied to an order later brings its proofs along. An approved proof
--     tied to an order marks the order "Artwork approved".
-- Back-check: every proof on file.

alter table public.vendor_links add column if not exists superseded_at timestamptz;
comment on column public.vendor_links.superseded_at is 'A proof replaced by a later version before the artwork was approved: "Earlier version, not used" (Dana, Oct 20).';

-- the order a proof belongs to
create or replace function public.proof_order_for(p_link public.vendor_links) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select l.order_id from public.vendor_links l where l.email_id = p_link.email_id and l.order_id is not null and l.id <> p_link.id order by l.created_at limit 1),
    (select c.order_id from public.order_checks c where c.email_id = p_link.email_id and c.order_id is not null order by c.created_at desc limit 1),
    (select e.order_id from public.emails e where e.id = p_link.email_id),
    (select x.order_id from public.emails e join public.emails t on t.thread_id = e.thread_id
       cross join lateral (
         select coalesce(t.order_id,
                         (select l.order_id from public.vendor_links l where l.email_id = t.id and l.order_id is not null limit 1),
                         (select c.order_id from public.order_checks c where c.email_id = t.id and c.order_id is not null limit 1)) as order_id) x
      where e.id = p_link.email_id and x.order_id is not null
      order by t.received_at desc limit 1),
    (select max(o.id::text)::uuid from public.orders o
      where o.vendor_id = p_link.vendor_id and o.status in ('open', 'awaiting_confirmation', 'confirmed')
     having count(*) = 1))
$$;
revoke execute on function public.proof_order_for(public.vendor_links) from public, anon;
grant execute on function public.proof_order_for(public.vendor_links) to service_role;

create or replace function public.vendor_links_proof_order() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind in ('proof', 'approved_proof') and new.order_id is null and new.email_id is not null then
    new.order_id := public.proof_order_for(new);
  end if;
  return new;
end;
$$;
drop trigger if exists vendor_links_proof_order on public.vendor_links;
create trigger vendor_links_proof_order before insert or update of kind, email_id on public.vendor_links
  for each row execute function public.vendor_links_proof_order();

-- an approved proof tied to an order: the order shows "Artwork approved"
create or replace function public.vendor_links_proof_order_art() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'approved_proof' and new.order_id is not null then
    update public.orders set art_approved_at = coalesce(new.approved_at, now()) where id = new.order_id and art_approved_at is null;
  end if;
  return null;
end;
$$;
drop trigger if exists vendor_links_proof_order_art on public.vendor_links;
create trigger vendor_links_proof_order_art after insert or update of kind, order_id on public.vendor_links
  for each row execute function public.vendor_links_proof_order_art();

-- a confirmation tied to its order later brings the proofs from the same email or conversation along
create or replace function public.order_checks_proof_order() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.order_id is null or new.email_id is null or (tg_op = 'UPDATE' and old.order_id is not distinct from new.order_id) then return null; end if;
  update public.vendor_links l set order_id = new.order_id
   where l.kind in ('proof', 'approved_proof') and l.order_id is null and l.vendor_id = new.vendor_id
     and l.email_id in (select t.id from public.emails e join public.emails t on t.thread_id = e.thread_id where e.id = new.email_id);
  return null;
end;
$$;
drop trigger if exists order_checks_proof_order on public.order_checks;
create trigger order_checks_proof_order after insert or update of order_id on public.order_checks
  for each row execute function public.order_checks_proof_order();

-- approved: the version in the vendor's latest email with proofs before our OK gets the star; earlier ones are not used
create or replace function public.thread_art_approved()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_when  timestamptz;
  v_final uuid;
begin
  if new.art_status is distinct from 'approved' or old.art_status is not distinct from 'approved' then return new; end if;
  -- when: our newest reply in the conversation, else now
  select max(received_at) into v_when from public.emails where thread_id = new.id and direction = 'out';
  v_when := coalesce(v_when, now());
  select e.id into v_final from public.emails e join public.vendor_links l on l.email_id = e.id and l.kind = 'proof'
   where e.thread_id = new.id and e.received_at <= v_when order by e.received_at desc limit 1;
  if v_final is null then
    select e.id into v_final from public.emails e join public.vendor_links l on l.email_id = e.id and l.kind = 'proof'
     where e.thread_id = new.id order by e.received_at desc limit 1;
  end if;
  update public.vendor_links set kind = 'approved_proof', approved_at = v_when, approved_by = null, superseded_at = null
   where kind = 'proof' and email_id = v_final;
  update public.vendor_links set superseded_at = v_when
   where kind = 'proof' and superseded_at is null and email_id <> v_final
     and email_id in (select id from public.emails where thread_id = new.id and received_at <= v_when);
  update public.tasks t set done_at = now(), done_note = 'Earlier version, not used'
    from public.vendor_links l
   where t.auto_key = 'proof:' || l.id and t.done_at is null and l.superseded_at is not null
     and l.email_id in (select id from public.emails where thread_id = new.id);
  -- the order: one the conversation's emails or its proofs are filed to
  update public.orders set art_approved_at = v_when
   where art_approved_at is null and id in (
     select order_id from public.emails where thread_id = new.id and order_id is not null
     union select order_id from public.vendor_links where order_id is not null and email_id in (select id from public.emails where thread_id = new.id)
     union select order_id from public.order_checks where order_id is not null and email_id in (select id from public.emails where thread_id = new.id));
  return new;
end;
$$;

-- starring one by hand takes it out of "earlier version"
create or replace function public.vendor_link_proof_approve(p_link uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare l public.vendor_links%rowtype;
begin
  select * into l from public.vendor_links where id = p_link;
  if l.id is null or not public.user_in_org(l.organization_id) or not public.user_can_edit() then raise exception 'File not found' using errcode = '23503'; end if;
  if l.kind not in ('proof', 'approved_proof') then raise exception 'That file is not a proof' using errcode = '22023'; end if;
  update public.vendor_links set kind = case when p_on then 'approved_proof' else 'proof' end,
         approved_at = case when p_on then now() end, approved_by = case when p_on then auth.uid() end,
         superseded_at = case when p_on then null else superseded_at end
   where id = p_link;
end;
$$;
revoke execute on function public.vendor_link_proof_approve(uuid, boolean) from public, anon;
grant execute on function public.vendor_link_proof_approve(uuid, boolean) to authenticated, service_role;

-- back-check: every proof on file gets its order; approved conversations keep the star on their final version only
do $$
declare n_order int; n_super int := 0; t record; v_final uuid; v_when timestamptz;
begin
  update public.vendor_links l set order_id = public.proof_order_for(l)
   where l.kind in ('proof', 'approved_proof') and l.order_id is null and l.email_id is not null and public.proof_order_for(l) is not null;
  get diagnostics n_order = row_count;
  for t in select id from public.email_threads where art_status = 'approved' loop
    select max(received_at) into v_when from public.emails where thread_id = t.id and direction = 'out';
    select e.id into v_final from public.emails e join public.vendor_links l on l.email_id = e.id and l.kind in ('proof', 'approved_proof')
     where e.thread_id = t.id and e.received_at <= coalesce(v_when, now()) order by e.received_at desc limit 1;
    -- stars VMS gave (not ones a person set) on earlier versions come off
    update public.vendor_links set kind = 'proof', approved_at = null, superseded_at = coalesce(v_when, now())
     where kind = 'approved_proof' and approved_by is null and email_id <> v_final
       and email_id in (select id from public.emails where thread_id = t.id);
    get diagnostics n_super = row_count;
  end loop;
  raise notice 'proof back-check: % proofs tied to their order, % earlier versions unstarred', n_order, n_super;
end $$;
