-- 0108 — Proofs and the main rep (Dana, Oct 15).
-- • Proofs: "it should be under proofs, and we should have some sort of indicator if we have marked it as approved or not."
--   One Proofs folder: kind proof (not approved yet) and approved_proof (approved, starred), with who approved it and when.
--   A file that comes in by email named like a proof ("…_PROOF.pdf", "Art Approval V3", "mock-up") is filed there instead of
--   Other or Images; the same rule is applied to everything already filed (the Oct 14 back-check rule).
-- • Main rep: with a rep group, the company's own people learned from email are customer service, never "our rep"
--   (Heather at Planet Cotton showed at the top instead of Maryellen). The ones already learned are fixed.

alter table public.vendor_links drop constraint if exists vendor_links_kind_check;
alter table public.vendor_links add constraint vendor_links_kind_check check (kind in ('catalog', 'price_list', 'order_form', 'specials', 'website', 'other',
  'invoice', 'credit', 'confirmation', 'order', 'ls_po', 'packing_slip', 'payment', 'freight_bill', 'delivery_receipt', 'image', 'approved_proof', 'damage_photo',
  'sales_report', 'proof'));
alter table public.vendor_links add column if not exists approved_at timestamptz;
alter table public.vendor_links add column if not exists approved_by uuid references public.profiles(id) on delete set null;
comment on column public.vendor_links.approved_at is 'A proof we approved (kind approved_proof): when, and approved_by who (Dana, Oct 15).';

-- Named like an artwork proof: "proof", "proofs", "mock-up", "art approval", "virtual sample".
create or replace function public.is_proof_name(p_name text) returns boolean language sql immutable as $$
  select coalesce(p_name, '') ~* '(^|[^a-z])proofs?([^a-z]|$)|mock[- ]?ups?([^a-z]|$)|art(work)? approval|virtual sample'
$$;
grant execute on function public.is_proof_name(text) to authenticated, service_role;

-- Filed by VMS (a new file from email, or VMS re-sorting one): a proof goes to Proofs, not Other or Images. A person moving
-- a file by hand is left alone.
create or replace function public.vendor_links_proof_kind() returns trigger language plpgsql as $$
begin
  if new.kind in ('other', 'image') and new.source = 'email' and public.is_proof_name(new.file_name)
     and (tg_op = 'INSERT' or auth.uid() is null) then
    new.kind := 'proof';
  end if;
  return new;
end;
$$;
drop trigger if exists vendor_links_proof_kind on public.vendor_links;
create trigger vendor_links_proof_kind before insert or update of kind on public.vendor_links
  for each row execute function public.vendor_links_proof_kind();

-- "Mark approved" / "Not approved" on a proof (editors).
create or replace function public.vendor_link_proof_approve(p_link uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare l public.vendor_links%rowtype;
begin
  select * into l from public.vendor_links where id = p_link;
  if l.id is null or not public.user_in_org(l.organization_id) or not public.user_can_edit() then raise exception 'File not found' using errcode = '23503'; end if;
  if l.kind not in ('proof', 'approved_proof') then raise exception 'That file is not a proof' using errcode = '22023'; end if;
  update public.vendor_links set kind = case when p_on then 'approved_proof' else 'proof' end,
         approved_at = case when p_on then now() end, approved_by = case when p_on then auth.uid() end
   where id = p_link;
end;
$$;
revoke execute on function public.vendor_link_proof_approve(uuid, boolean) from public, anon;
grant execute on function public.vendor_link_proof_approve(uuid, boolean) to authenticated, service_role;

-- Back-check: proofs already filed in Other or Images, for every vendor.
update public.vendor_links set kind = 'proof' where kind in ('other', 'image') and public.is_proof_name(file_name);

-- Back-check: the company's own people learned from email on rep-group vendors are customer service, not our rep.
update public.vendor_emails e set roles = (select array_agg(distinct case when r = 'rep' then 'customer_service'::public.contact_type else r end) from unnest(e.roles) r),
       contact_type = case when e.contact_type = 'rep' then 'customer_service'::public.contact_type else e.contact_type end
  from public.vendors v
 where v.id = e.vendor_id and v.rep_group_id is not null and e.source = 'email_enrichment' and 'rep' = any(e.roles);
