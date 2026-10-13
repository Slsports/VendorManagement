-- 0112 — Several phone numbers per contact, each with its type (Dana, Oct 13): "I would also like a place for a work phone
-- and a cell phone and when you add a new rep to a vendor you are able to check a box for the type of phone it is, I know
-- David Davila had several numbers listed so we need more flexibility." Types: Work, Cell, Fax, Other ("Isn't Work and
-- Office the same?"); Other takes a typed label ("if you pick other you are able to type in what it is").
-- phones is a list of {number, type, label, ext}; the old phone column stays as the first number (calls, search, older code).

alter table public.vendor_emails add column if not exists phones jsonb not null default '[]'::jsonb;
alter table public.rep_group_contacts add column if not exists phones jsonb not null default '[]'::jsonb;
comment on column public.vendor_emails.phones is 'Phone numbers: [{number, type: work|cell|fax|other, label (for other), ext}]. phone = the first number.';
comment on column public.rep_group_contacts.phones is 'Phone numbers: [{number, type: work|cell|fax|other, label (for other), ext}]. phone = the first number.';

-- "Cell: 208-969-9739  Office: 559-977-1402", "619-804-8779 Cell", "(800) 541-2929 x12" → a phones list.
create or replace function public.phones_from_text(p text)
returns jsonb language plpgsql immutable as $$
declare
  m text[];
  out jsonb := '[]'::jsonb;
  word text;
  t text;
  lbl text;
begin
  if coalesce(trim(p), '') = '' then return out; end if;
  for m in
    select regexp_matches(p, '(?:(cell|mobile|mob|office|work|direct|main|fax|home|text)\s*[:.#-]?\s*)?(\+?1?[\s.-]?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4})(?:\s*(?:x|ext\.?|extension)\s*(\d{1,6}))?(?:\s*[(-]?\s*(cell|mobile|mob|office|work|direct|main|fax|home|text)\M\)?)?', 'gi')
  loop
    word := lower(coalesce(m[1], m[4], ''));
    lbl := null;
    t := case
      when word in ('cell', 'mobile', 'mob', 'text') then 'cell'
      when word = 'fax' then 'fax'
      when word = 'home' then 'other'
      else 'work' end;
    if word = 'home' then lbl := 'Home'; end if;
    out := out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('number', trim(m[2]), 'type', t, 'label', lbl, 'ext', m[3])));
  end loop;
  -- something that is not a number pattern (a short extension-only note, a foreign number): keep it as it was
  if jsonb_array_length(out) = 0 then
    out := jsonb_build_array(jsonb_build_object('number', trim(p), 'type', 'work'));
  end if;
  return out;
end;
$$;
grant execute on function public.phones_from_text(text) to authenticated, service_role;

-- Keep phone (the first number) and phones in step, whichever one the change came through.
create or replace function public.contact_phones_sync()
returns trigger language plpgsql as $$
begin
  if new.phones is null then new.phones := '[]'::jsonb; end if;
  if tg_op = 'UPDATE' and new.phones is distinct from old.phones then
    new.phone := nullif(trim(new.phones -> 0 ->> 'number'), '');
  elsif tg_op = 'UPDATE' and new.phone is distinct from old.phone then
    new.phones := case when coalesce(trim(new.phone), '') = '' then '[]'::jsonb else public.phones_from_text(new.phone) end;
  elsif tg_op = 'INSERT' and jsonb_array_length(new.phones) > 0 then
    new.phone := nullif(trim(new.phones -> 0 ->> 'number'), '');
  elsif tg_op = 'INSERT' and coalesce(trim(new.phone), '') <> '' then
    new.phones := public.phones_from_text(new.phone);
  end if;
  if jsonb_array_length(new.phones) > 0 then
    new.phone := nullif(trim(new.phones -> 0 ->> 'number'), '');
  end if;
  return new;
end;
$$;
drop trigger if exists vendor_emails_phones on public.vendor_emails;
create trigger vendor_emails_phones before insert or update on public.vendor_emails for each row execute function public.contact_phones_sync();
drop trigger if exists rep_group_contacts_phones on public.rep_group_contacts;
create trigger rep_group_contacts_phones before insert or update on public.rep_group_contacts for each row execute function public.contact_phones_sync();

-- What is on file now.
update public.vendor_emails set phones = public.phones_from_text(phone) where coalesce(trim(phone), '') <> '' and phones = '[]'::jsonb;
update public.rep_group_contacts set phones = public.phones_from_text(phone) where coalesce(trim(phone), '') <> '' and phones = '[]'::jsonb;
