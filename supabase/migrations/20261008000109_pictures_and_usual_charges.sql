-- 0109 — Pictures and usual charges (Dana, Oct 15).
-- • "I don't want logos downloaded, total waste … I don't want to have to sift through a bunch of useless logos just to
--   find pictures of products." Claude looks at each picture in a vendor's email first and says what it is (picture_kind):
--   product, proof, advertising, logo or other. Logos are never saved; a rep group's logos of the companies it reps add
--   those names to its lines.
-- • "Nationwide sends way too many emails of the same stuff": vendors marked ask_before_pictures get nothing saved by
--   themselves except proofs ("proofs or things to approve those need to get auto saved"); their advertising and product
--   pictures wait for Save pictures in the email. Their invoices and confirmations are filed as before.
-- • "There's always a tag charge with Planet Cotton and some of our other independent vendors": usual_charges on the
--   vendor ([{what, price, per}]); a confirmation or invoice charge that matches one at its price is not an issue.

alter table public.vendors add column if not exists ask_before_pictures boolean not null default false;
alter table public.vendors add column if not exists usual_charges jsonb not null default '[]'::jsonb;
comment on column public.vendors.ask_before_pictures is 'Pictures from this vendor are not saved by themselves (proofs are); Save pictures in the email (Dana, Oct 15: Nationwide).';
comment on column public.vendors.usual_charges is 'Charges this vendor always adds, e.g. [{"what":"Tags","price":0.15,"per":"each"}]: not an issue on their papers (Dana, Oct 15).';

alter table public.email_attachments add column if not exists picture_kind text check (picture_kind in ('product', 'proof', 'advertising', 'logo', 'other'));
alter table public.email_attachments add column if not exists picture_company text;
comment on column public.email_attachments.picture_kind is 'What Claude saw in this picture: product, proof, advertising, logo or other (Dana, Oct 15).';

update public.vendors set ask_before_pictures = true where id = '3c0b4e19-e2ce-4d23-8d78-0db2734409ca';
update public.vendors set usual_charges = '[{"what": "Tags", "price": 0.15, "per": "each"}]'::jsonb
 where id = '8ddde2cd-7328-45b6-8219-b10a8bf97587' and usual_charges = '[]'::jsonb;

-- "This is a usual charge for this vendor" on a check row (editors): adds it, or updates the price of one with that name.
create or replace function public.vendor_usual_charge_add(p_vendor uuid, p_what text, p_price numeric, p_per text default 'each')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.vendors%rowtype;
  w text := nullif(trim(coalesce(p_what, '')), '');
  out jsonb;
begin
  select * into v from public.vendors where id = p_vendor;
  if v.id is null or not public.user_in_org(v.organization_id) or not public.user_can_edit() then raise exception 'Vendor not found' using errcode = '23503'; end if;
  if w is null then raise exception 'Say what the charge is' using errcode = '22023'; end if;
  select coalesce(jsonb_agg(c), '[]'::jsonb) into out from jsonb_array_elements(v.usual_charges) c where lower(c->>'what') <> lower(w);
  out := out || jsonb_build_array(jsonb_build_object('what', left(w, 80), 'price', p_price, 'per', coalesce(nullif(trim(p_per), ''), 'each')));
  update public.vendors set usual_charges = out where id = p_vendor;
  return out;
end;
$$;
revoke execute on function public.vendor_usual_charge_add(uuid, text, numeric, text) from public, anon;
grant execute on function public.vendor_usual_charge_add(uuid, text, numeric, text) to authenticated, service_role;
