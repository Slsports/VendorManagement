# Gmail connection — build plan

Read `CLAUDE.md` and the tail of `docs/decisions.md` first. This page is the design any session follows
to connect VMS to the orders@ mailbox. Spec §10 chose the Gmail API with read access; the decisions log
(Oct 7) chose a service account with domain-wide delegation. Dana completes the Google side herself; the
secret never passes through chat or the repo.

## Prerequisites Dana provides
- Google Cloud project "RetailHQ VMS", Gmail API enabled, service account `vms-mail` with a JSON key.
- Domain-wide delegation in the Admin console for that service account's client ID with scopes
  `https://www.googleapis.com/auth/gmail.modify` and `https://www.googleapis.com/auth/gmail.send`.
- Supabase Edge Function secret `GOOGLE_SERVICE_ACCOUNT_JSON` = the key file. Add `GMAIL_MAILBOX`
  = `orders@shaverlakesports.com` as a second secret (not sensitive, but keeps the mailbox out of code).

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

## UI
- Mail page (`/mail`): list with filters Mine / Everyone / Unassigned / Unmatched, vendor, status;
  row shows from, subject, snippet, vendor badge, assignee picker (reuse `AssigneeSelect`), attachments.
  Opening a mail shows the body, attachments with "File to vendor" (creates a `vendor_links` row and copies
  the attachment), "Attach to order" (vendor's orders), and Reply, which sends through `gmail-send`.
- Vendor page: a Mail section listing that vendor's threads, newest first.
- Needs page (`/needs`): the list with status chips; dashboard count.
- Settings > Integrations: connection status (last sync, mailbox, messages count), "Sync now".
- Dashboard: "Mail waiting on you" count next to the review count.

## First jobs once connected (from the decisions log)
1. Find Dana's Aug 2 2026 cancellation emails to Charlene Lal (Ty) and close the ten backordered lines.
2. Backfill vendor contacts from the history into the review queue (spec §5).
3. Import `Assigned/<name>` labels Dana applied this week.

## Done when
Mail from the last 12 months is in `emails` with vendor matches above 80 percent, labels round-trip,
a reply sent from VMS arrives with the sender's signature, the Needs list shows the "Need to Order"
label, and `npm run db:test`, lint, typecheck and tests pass. Log the outcome in `docs/decisions.md`.
