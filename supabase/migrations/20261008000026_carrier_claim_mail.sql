-- 0047 — Add or edit a freight carrier on the Freight bills page (Dana, Oct 8). Saving a carrier with its
-- email domains claims the mail already in VMS: undecided senders from those domains become the carrier,
-- their threads go to the Freight tab and its owner, and the next syncs read their bills and receipts.
-- Senders a person already answered (vendor, rep group, …) are left as they are.
create or replace function public.carrier_claim_mail(p_carrier uuid)
returns integer
language plpgsql security definer
set search_path = public
as $$
declare
  c  public.carriers%rowtype;
  s  record;
  r  record;
  n  integer := 0;
begin
  if not public.user_can_edit() then raise exception 'Only admins, managers and buyers edit carriers' using errcode = '42501'; end if;
  select * into c from public.carriers where id = p_carrier;
  if c.id is null or not public.user_in_org(c.organization_id) then raise exception 'Carrier not found' using errcode = '23503'; end if;
  if not c.is_active then return 0; end if;
  for s in select es.id, es.review_item_id from public.email_senders es
            where es.organization_id = c.organization_id and es.kind = 'unknown'
              and public.mail_carrier_for(es.organization_id, es.sender_key) = c.id loop
    update public.email_senders set kind = 'carrier', carrier_id = c.id, decided_by = auth.uid(), decided_at = now() where id = s.id;
    update public.review_items set status = 'accepted', resolved_by = auth.uid(), resolved_at = now(), resolution_note = 'Freight carrier: ' || c.name
     where id = s.review_item_id and status = 'pending';
    n := n + 1;
  end loop;
  for r in select distinct e.thread_id from public.emails e join public.email_senders es on es.id = e.sender_id
            where es.carrier_id = c.id and es.kind = 'carrier' loop
    perform public.mail_mark_carrier_thread(r.thread_id);
  end loop;
  return n;
end;
$$;
revoke execute on function public.carrier_claim_mail(uuid) from public, anon;
grant execute on function public.carrier_claim_mail(uuid) to authenticated, service_role;
