-- 135: pages captured from the Worldwide portal (Dana, Oct 16): WWD's IT will not export the vendor directory ("that
-- information is not available and would need to come directly from the vendors"), so a "Send to VMS" bookmark sends
-- the portal page Dana is looking at to VMS. Step 1 keeps the pages as they are, so the reader that pulls every vendor
-- is written from the real pages, not guessed. Admin only.

create table if not exists public.portal_captures (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  profile_id      uuid references public.profiles(id) on delete set null,
  source          text not null default 'wwd_portal',
  url             text,
  title           text,
  html            text not null,
  size            integer generated always as (length(html)) stored,
  how             text not null default 'bookmark' check (how in ('bookmark', 'upload')),
  created_at      timestamptz not null default now()
);
comment on table public.portal_captures is 'Pages sent from the Worldwide portal by the Send to VMS bookmark (or uploaded as a saved file).';
create index if not exists portal_captures_org on public.portal_captures (organization_id, created_at desc);
alter table public.portal_captures enable row level security;
drop policy if exists "portal_captures: admin reads" on public.portal_captures;
create policy "portal_captures: admin reads" on public.portal_captures for select to authenticated using (public.user_in_org(organization_id) and public.is_admin());
drop policy if exists "portal_captures: admin deletes" on public.portal_captures;
create policy "portal_captures: admin deletes" on public.portal_captures for delete to authenticated using (public.user_in_org(organization_id) and public.is_admin());
grant select, delete on public.portal_captures to authenticated;
grant all on public.portal_captures to service_role;

-- the bookmark carries a private key that names the person; only the portal-capture function reads it
create table if not exists public.capture_keys (
  profile_id      uuid primary key references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key             uuid not null unique default gen_random_uuid(),
  created_at      timestamptz not null default now()
);
alter table public.capture_keys enable row level security;
grant all on public.capture_keys to service_role;

/** The signed-in admin's bookmark key (made the first time). */
create or replace function public.portal_capture_key()
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_key uuid;
begin
  if not public.is_admin() then raise exception 'Only the admin sends portal pages' using errcode = '42501'; end if;
  select organization_id into v_org from public.profiles where id = auth.uid();
  insert into public.capture_keys (profile_id, organization_id) values (auth.uid(), v_org)
  on conflict (profile_id) do nothing;
  select key into v_key from public.capture_keys where profile_id = auth.uid();
  return v_key;
end;
$$;
revoke execute on function public.portal_capture_key() from public, anon;
grant execute on function public.portal_capture_key() to authenticated;

/** A page saved from the portal and uploaded by hand (when the portal blocks the bookmark from sending it). */
create or replace function public.portal_capture_upload(p_url text, p_title text, p_html text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'Only the admin sends portal pages' using errcode = '42501'; end if;
  if length(coalesce(p_html, '')) = 0 or length(p_html) > 15000000 then raise exception 'That file is empty or too big' using errcode = '22023'; end if;
  select organization_id into v_org from public.profiles where id = auth.uid();
  insert into public.portal_captures (organization_id, profile_id, url, title, html, how)
  values (v_org, auth.uid(), nullif(p_url, ''), nullif(p_title, ''), p_html, 'upload') returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.portal_capture_upload(text, text, text) from public, anon;
grant execute on function public.portal_capture_upload(text, text, text) to authenticated;
