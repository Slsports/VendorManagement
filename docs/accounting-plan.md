# Accounting area — build plan (Dana, Oct 16, 2026: "go")

Dana runs the company's bookkeeping out of billing.slsports@gmail.com: taxes, insurance (many policies), banking,
donation requests, contract renewals, the accounting/bookkeeping firm, and bills that are not vendor invoices. She wants
the same treatment orders@ gets (mail views, automatic document filing, tasks and reminders) and a single place that
shows what she is missing. Only she sees it; later she may let one more person in without making them admin.

## 1. Mailbox
- billing.slsports@gmail.com is a plain Gmail (outside Workspace), so VMS cannot read it with the service account.
  Dana creates **billing@shaverlakesports.com** in Workspace, imports the Gmail's mail into it (Gmail "Import mail and
  contacts", or Admin console Data migration), and sets the old address to forward. The old Gmail stays alive for logins
  that still use it (Claude, Anthropic console).
- VMS: add a `mailboxes` row for billing@ owned by Dana (`gmail_box` = billing@), synced by `gmail-sync` like the staff
  mailboxes, 12 months back. Private to the owner and the admin by the existing RLS; see §2 for the extra gate.

## 2. Permission
- New profile flag `sees_accounting` (like `places_orders`, `sees_freight`). Dana gets it; Settings → Users lets the
  admin tick it for one more person. Admin alone is not enough: the Accounting menu entry, routes and every accounting
  table check the flag, so a future admin backup (Nick) does not see it unless ticked.
- Accounting mail: the billing@ mailbox row carries `kind = 'accounting'`; its threads/emails/files are readable only by
  profiles with `sees_accounting` (RLS), never listed on the org-wide Mail page, never copied into org-wide tables.

## 3. Accounting mail
- Same views as orders@: Needs an answer, Waiting on them, Documents, Other. Senders are tagged to a category:
  taxes, insurance, banking, donations, contracts, accounting firm, bills, other. Sender proposals go to the review
  queue as today, visible only to accounting people.
- Reply/forward from billing@ with Dana's signature (existing send machinery, `gmail_box` = billing@).

## 4. Automatic filing
- Every attachment is read and filed into a folder tree under Accounting: Insurance / <carrier> / <year>,
  Taxes / <year> / <quarter or form>, Banking / <bank> / <year>, Donations / <year>, Contracts / <party>,
  Accounting firm / <year>, Bills / <payee> / <year>. Files are renamed (date, payee, what it is) and keep a link to the
  email they came from. Unsure files go to a review pile; nothing is dropped.
- A **drop box** page: drag folders of files from Dana's computer (the downloaded backlog); they are filed the same way.

## 4b. Contacts (Dana, Oct 16)
- `accounting_contacts`: company, person, role (agent, CPA, banker, adjuster, …), category (taxes, insurance, banking,
  donations, contracts, accounting firm, bills, other), emails, phones, notes, last contact. One simple card each, far
  lighter than the vendor page: who they are, how to reach them, the mail with them, their files, open tasks.
- Seeded from the billing@ mail: every sender/recipient that is not bulk becomes a proposed contact (review pile, same as
  vendor sender proposals), with company guessed from the email domain and signature. Dana confirms or merges.
- The category tags in §3 come from the contact, so filing and views follow the contact's category.

## 5. Bills that are not vendor invoices
- `accounting_bills`: payee, category, amount, due date, paid date, how paid, file, email, notes. Created from emails
  when the reader finds a bill; editable; "Paid" marks it. A Due list like the Payments page.

## 6. Tasks, reminders, the "what am I missing" page
- Accounting tasks are ordinary tasks with `area = 'accounting'`; they show only in the Accounting area and only to
  accounting people (RLS on the flag). Due dates, repeats, reminders by dashboard/email/text as today.
- Made automatically: an email that needs an answer → task; a bill → "Pay <payee> by <date>"; a renewal or deadline
  found in a document → task 30 days ahead; recurring jobs Dana sets up once repeat on their own.
- **Accounting home** = what am I missing: overdue, due this week, waiting on someone else, unanswered emails, oldest
  first. Feeds the dashboard. A **calendar** view shows the same by month.

## 7. Order of build
1. Mailbox row + flag + menu entry + RLS (migration, tests, types, Settings → Users tick).
2. Accounting mail views, contacts list with proposals from the mail, sender categories.
3. Filing into the folder tree + drop box.
4. Bills list.
5. Tasks, auto-made tasks, home page, calendar.
Help articles with each step (Accounting section).
