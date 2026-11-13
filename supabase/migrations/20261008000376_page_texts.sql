-- 0376 — The paragraph under each page's title is Dana's to edit on the page (Dana, Nov 13: "Is there any way that the
-- paragraph under the title of each page can be edited by me anytime?" … "I like editing it on its page so I can view
-- what's on it as I type - go"). A saved wording replaces the built-in one for everyone; removing it puts the original back.
set local lock_timeout = '5s';

create table if not exists public.page_texts (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  page_key        text not null,
  description     text not null,
  updated_by      uuid references public.profiles(id) on delete set null,
  updated_at      timestamptz not null default now(),
  primary key (organization_id, page_key)
);
comment on table public.page_texts is 'Dana''s wording for the paragraph under a page''s title, by page address (Nov 13).';
alter table public.page_texts enable row level security;
drop policy if exists page_texts_read on public.page_texts;
create policy page_texts_read on public.page_texts for select to authenticated using (public.user_in_org(organization_id));
drop policy if exists page_texts_admin_write on public.page_texts;
create policy page_texts_admin_write on public.page_texts for all to authenticated
  using (public.user_in_org(organization_id) and public.is_admin()) with check (public.user_in_org(organization_id) and public.is_admin());
grant select, insert, update, delete on public.page_texts to authenticated;
grant all on public.page_texts to service_role;

create or replace function public.page_texts_touch() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;
revoke execute on function public.page_texts_touch() from public, anon, authenticated;
drop trigger if exists page_texts_touch on public.page_texts;
create trigger page_texts_touch before insert or update on public.page_texts for each row execute function public.page_texts_touch();
