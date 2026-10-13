-- 0110 — One signature for everyone, with the logo (Dana, Oct 12-13): "I like the ability to adjust my signature, is it possible
-- to have our signature template embedded in each email with the ability to edit it?" With the logo; "it should only say
-- Shaver Lake Sports, not with the Inc"; no Facebook links; never a personal email (orders@ only).
-- The admin keeps the template under Settings › Mail; each person's name, title and direct phone fill it in. Someone may keep
-- their own version (profiles.email_signature); otherwise the template is used. The signature shows in the compose window and
-- can be changed for one email; drafts keep theirs.

alter table public.organizations add column if not exists signature_template text;
alter table public.profiles add column if not exists signature_name text;
alter table public.profiles add column if not exists job_title text;
alter table public.profiles add column if not exists direct_phone text;
alter table public.email_drafts add column if not exists signature text;
comment on column public.organizations.signature_template is 'Email signature for everyone: {name}, {title} and {direct} (" | Direct: phone" when the person has one) are filled in per person. The logo shows above it.';
comment on column public.profiles.email_signature is 'The person''s own signature, used instead of the organization template when set.';

update public.organizations set signature_template = coalesce(signature_template, E'{name}\n{title}\nShaver Lake Sports\n41777 Tollhouse Road, Shaver Lake, CA 93664\nMailing: P.O. Box 60, Shaver Lake, CA 93664\nStore: 559-841-2740{direct}\norders@shaverlakesports.com | shaverlakesports.com');

-- The three signatures on file were name, store and title: they move into the template.
update public.profiles set signature_name = split_part(email_signature, E'\n', 1), job_title = split_part(email_signature, E'\n', 3), email_signature = null
 where email_signature ~ E'^[^\n]+\nShaver Lake Sports\n[^\n]+$';
