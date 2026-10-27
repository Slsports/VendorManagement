-- 0251 — Documents on a rep group (Dana, Oct 27: "it clearly says Dandylines and Diverse Marketing and it's not an order,
-- it is info from the last show, it goes with the rep group"). A file can belong to a rep group the way it can to a
-- vendor or a line: show info, buyer letters, line lists. The Dropbox read proposes it ("Rep group") and Dana can pick a
-- rep group herself on the Dropbox list.
alter table public.vendor_links add column if not exists rep_group_id uuid references public.rep_groups(id) on delete cascade;
create index if not exists vendor_links_rep_group_idx on public.vendor_links (rep_group_id) where rep_group_id is not null;
alter table public.vendor_links drop constraint if exists vendor_links_check;
alter table public.vendor_links add constraint vendor_links_check check (vendor_id is not null or line_id is not null or rep_group_id is not null);
alter table public.dropbox_files add column if not exists rep_group_id uuid references public.rep_groups(id) on delete set null;
alter table public.dropbox_files drop constraint if exists dropbox_files_target_check;
alter table public.dropbox_files add constraint dropbox_files_target_check check (target in ('vendor', 'line', 'rep', 'freight', 'accounting', 'skip'));
