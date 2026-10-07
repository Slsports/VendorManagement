# Gmail connection — build plan

Read `CLAUDE.md` and the tail of `docs/decisions.md` first. This page is the design any session follows
to connect VMS to the orders@ mailbox. Spec §10 chose the Gmail API with read access; the decisions log
(Oct 7) chose a service account with domain-wide delegation. Dana completes the Google side herself; the
secret never passes through chat or the repo.

## Prerequisites Dana provides (done Oct 7, verified)
- Google Cloud project "SLS VMS" (ID `sls-vms`, under the shaverlakesports.com organization), Gmail API
  enabled, service account `vms-mail@sls-vms.iam.gserviceaccount.com` (unique ID 105836244077506020559)
  with a JSON key. Key creation is allowed on this project only: the org policy
  `iam.managed.disableServiceAccountKeyCreation` is overridden to not enforced on `sls-vms`.
- Domain-wide delegation in the Admin console for that service account's client ID with scopes
  `https://www.googleapis.com/auth/gmail.modify` and `https://www.googleapis.com/auth/gmail.send`.
- Supabase Edge Function secret `GOOGLE_SERVICE_ACCOUNT_JSON` = the key file. Add `GMAIL_MAILBOX`
  = `orders@shaverlakesports.com` as a second secret (not sensitive, but keeps the mailbox out of code).
- Both secrets are set. A test function impersonating orders@ read its profile on Oct 7 (16,748 messages,
  10,286 threads), so delegation and the key work; the test function was deleted.

## How VMS talks to Gmail
- Supabase Edge Function `gmail-sync` (Deno). Build a JWT from the service account (`iss` = client email,
  `sub` = the mailbox being impersonated, `scope` = the two scopes, `aud` = https://oauth2.googleapis.com/token),
  exchange it for an access token, call the Gmail REST API. No OAuth consent screens, no refresh tokens.
- Scheduled every 5 minutes with `pg_cron` + `pg_net` calling the function (service role header from
  Vault), plus a "Sync now" button for admins. First run does a backfill: newest first, 500 messages per
  run until the mailbox is covered. Store `history_id`; later runs use `users.history.list` and fall back
  to a full list when the history id has expired.
- Sending: Edge Function `gmail-send` impersonates orders@, builds the MIME message, appends the
  signed-in user's signature (`profiles.email_signature`), sets Reply-To orders@, records the sent message
  in `emails` with `direction = 'out'` and the thread.

## Tables (one migration, with tests and explicit grants, RLS by `user_in_org`, editors write)
- `emails`: organization_id, gmail_id (unique), thread_id, direction in|out, from_email, from_name,
  to_emails text[], cc_emails text[], subject, snippet, body_text, body_html (nullable, keep under 200 KB),
  received_at, labels text[], has_attachments, vendor_id (nullable), order_id (nullable),
  assigned_to (profiles), assigned_at, status in open|handled|ignored, match_how (sender|domain|manual|
  directory), created_at.
- `email_attachments`: email_id, gmail_attachment_id, file_name, mime_type, size, storage_path
  (bucket `vendor-files`, folder `<org>/mail/<email id>/`), vendor_link_id (set when filed).
- `profiles.email_signature` text (Dana writes them; shown in the account menu's profile page).
- `needs`: the Needs list (decisions log Oct 6): organization_id, title, requester, store_code, status
  needed|ordered|received, email_id (nullable), order_id (nullable), notes, created_by, created_at.

## Matching an email to a vendor (never guess; unmatched goes to review)
1. Exact sender address in `vendor_emails` → that vendor, `match_how = sender`.
2. Sender domain equals a vendor's website domain or an existing contact's domain → `domain`.
3. `directory_route_for` on the sender name or domain (the WWD show roster) → `directory`; also sets the
   vendor's route if the vendor has none.
4. Otherwise `vendor_id` null and a `review_items` row of kind `email_vendor` ("Which vendor is this?").
   Free-mail domains (gmail, yahoo, outlook, hotmail, icloud) never match by domain.
New contacts found in matched mail (signature blocks, From names) go to the review queue as
`vendor_contact` proposals, the enrichment the spec §5 describes. Nothing is written to a vendor silently.

## Labels and assignment
- Gmail label `Assigned/<First name>` → `assigned_to` = the profile whose full_name starts with that name;
  the star → `status = open` and sorted first. Changing the assignee in VMS writes the label back to Gmail.
- Otherwise `review_assignee_for` runs with the vendor (fishing vendors go to Jarrett) via a trigger on
  insert, same as review items.
- Label `Need to Order` → a `needs` row; marking it ordered in VMS swaps the Gmail label to `Placed Orders`.
- VMS never deletes or archives Gmail mail. Marking handled in VMS adds label `VMS/Handled` only.

## Working in VMS instead of Gmail (Dana and Fable, Oct 8)
Goal: people read, answer and chase vendor mail in VMS; Gmail is the backup you open when something odd
happens, not the place you work.
- **Thread table.** `email_threads`: organization_id, gmail_thread_id (unique), vendor_id, owner_id
  (profiles), status in `waiting_on_us` | `waiting_on_vendor` | `handled`, last_in_at, last_out_at,
  follow_up_at, subject, created_at. Ownership lives on the thread; `emails.assigned_to` mirrors it.
- **A reply goes to whoever sent the email.** Sending from VMS makes the sender the thread owner.
- **Threads stay with their owner.** Every later message in the thread goes to the owner, not just the
  first reply. Handing a thread to someone else (the assignee picker) moves the rest of it with it.
  New threads with no owner use the assignment rules (fishing vendors to Jarrett) as before.
- **Waiting on vendor, with a nudge.** Sending sets the thread to `waiting_on_vendor` and
  `follow_up_at` = sent + 5 days. A vendor reply sets it to `waiting_on_us`. No reply by
  `follow_up_at` puts it back on the owner's dashboard list as "No answer yet" with a one-click
  Follow up (a prefilled reply in the same thread). Five days is a setting in Settings > Mail.
- **Dashboard: "Mail for you".** A list, not just a count: new replies waiting on you and threads with
  no answer yet, each showing vendor, subject, a one-line preview and how long it has waited; one
  click opens the thread. Stays until answered, marked handled, or handed to someone else; a handed-over
  thread leaves your list and lands on the new owner's.
- **Badge on Mail** in the side menu with the number waiting on you, visible from any page.
- **Everything inside VMS.** Read, reply, reply all, forward, attach a file (from the computer or from
  the vendor's Links & files), open or download attachments, on the vendor page and the Mail page.
- **Shared, not private.** Ownership only decides whose list a thread lands on. Anyone who opens the
  vendor record sees every thread, its owner and what was said; anyone who can edit (admin, manager,
  buyer) can reply or take a thread over.
- **No phone or email alerts** from VMS for now; the dashboard list and the badge are enough, and Gmail
  already notifies anyone who wants that.

## UI
- Mail page (`/mail`): list with filters Mine / Everyone / Unassigned / Unmatched, vendor, status;
  row shows from, subject, snippet, vendor badge, assignee picker (reuse `AssigneeSelect`), attachments.
  Opening a mail shows the body, attachments with "File to vendor" (creates a `vendor_links` row and copies
  the attachment), "Attach to order" (vendor's orders), and Reply, which sends through `gmail-send`.
- Vendor page: a Mail section listing that vendor's threads, newest first, plus an **Email** button
  beside every address on the record (orders email, rep email, shipping contact email, each contact in
  the contact list) and a "New email" button in the Mail section with a To picker of all of them.
  It opens a compose box (To, Cc, subject, body, attachments) that sends through `gmail-send` from
  orders@ with the signed-in person's signature. The sent message is stored in `emails` with
  `vendor_id` set (`match_how = manual`), so it shows in the vendor's Mail section at once, and
  replies in that Gmail thread land on the same vendor automatically (thread_id match before any
  sender rule). Dana, Oct 8: "a button to email any of the contact emails for that record directly
  and the correspondence saves to the vendor file."
- Needs page (`/needs`): the list with status chips; dashboard count.
- Settings > Integrations: connection status (last sync, mailbox, messages count), "Sync now".
- Dashboard: "Mail waiting on you" count next to the review count.

## As built (Oct 8, Opus session)
- Tables: migrations `20261008000002_mail.sql` and `…03_mail_senders_platform.sql`. Ownership and status
  live on `email_threads` only (no `emails.assigned_to`); `email_senders` holds one answer per sending
  domain (or free-mail address): vendor, rep group, platform (sends for many vendors: NetSuite, Bill.com,
  FashionGo), not a vendor, or ours. `mail_accounts` holds the cursors and `follow_up_days`.
- `gmail-sync` stores plain-text bodies (20 KB cap) and attachment metadata only; HTML and files are
  fetched from Gmail when opened or filed. Each run takes about 100 messages (Edge Function CPU limits);
  pg_cron runs it every minute (`scripts/setup-mail-cron.mjs`) until the 12-month backfill is done.
- Vendor clues (`supabase/functions/_shared/mailMatch.ts`): the web address against vendor names
  (initials + last word, whole name), and vendor names in the subject, file names, From name (one-word
  names only here) and the message above the signature (multi-word names). SQL (`mail_process`) links
  what is known and keeps one review item per unknown sender, proposing a vendor only on the web address
  or a name in at least two emails and three in ten of them.
- Backfilled threads quiet for a week start as handled; newer ones wait on us or on the vendor.

## First jobs once connected (from the decisions log)
1. Find Dana's Aug 2 2026 cancellation emails to Charlene Lal (Ty) and close the ten backordered lines.
2. Backfill vendor contacts from the history into the review queue (spec §5).
3. Import `Assigned/<name>` labels Dana applied this week.

## Done when
Mail from the last 12 months is in `emails` with vendor matches above 80 percent, labels round-trip,
a reply sent from VMS arrives with the sender's signature, the Needs list shows the "Need to Order"
label, and `npm run db:test`, lint, typecheck and tests pass. Log the outcome in `docs/decisions.md`.
