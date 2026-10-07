# Orders and mail: how an order is born, placed, sent and checked

Dana's decisions of Oct 7 2026, written as the plan any session follows. Read `CLAUDE.md`,
`docs/gmail-connection.md` (the Mail build as it stands) and the tail of `docs/decisions.md` first.

## 1. Mail views: Needs attention / Offers & catalogs
Like Outlook's Focused and Other. The Mail page has a toggle with three views:
- **Needs attention** (default): replies, confirmations, invoices, questions, anything a person must act on.
  Anything VMS is unsure about lands here, never silently in offers.
- **Offers & catalogs**: specials, price lists, catalogs, newsletters.
- **Everything**: for searching.

How VMS sorts: Gmail's own category labels first (CATEGORY_PROMOTIONS = offers), then bulk-mail marks
(List-Unsubscribe header, noreply/marketing senders, "special", "sale", "catalog", "price list",
"new arrivals" in the subject), then a short Claude read of the rest. Moving one email between views
teaches VMS that sender (`mail_sender_rules`: sender → view). Column `emails.view` in
attention|offers plus `view_how` (gmail|rule|read|manual).

**As built (Oct 8, Opus):** `emails.view` / `view_how` / `is_bulk`, `email_threads.view`, and the sender's
learned view on `email_senders.view_rule` (instead of a separate `mail_sender_rules` table). Sorting is SQL
(`mail_view_for`, `mail_classify`): a person's answer for the sender, then conversations we wrote in,
then order/invoice/shipping words, then Gmail's Promotions tab, then List-Unsubscribe, then offer words;
anything else stays in Needs attention. The sync reads bulk-mail headers on new mail and works through
older mail 300 a run. Moving a conversation (`set_email_thread_view`) teaches the sender and moves its
other mail; Settings > Mail has "Re-sort all mail". The dashboard list and the Mail count only count
Needs attention. The Claude read is not built: no API key yet.

## 2. Files and links save themselves
On an offers email with an attachment (PDF, XLSX, CSV, image): save it into that vendor's Catalogs,
price lists & files (`vendor_links`) with kind price_list | catalog | specials | order_form guessed from
the file name and subject, `season_label` from the subject or date, `received_at` the email date,
`source = 'email'`, and the email linked. Links in the body that point at a catalog or price list
(PDF/XLSX links, "view our catalog", "download price list") are saved as link rows the same way.
Nothing is deleted: the newest of a kind is marked current, older ones stay as history. Vendor order
writers that arrive by email are saved as kind `order_form`, which is also what section 3 reads.

**As built (Oct 8, Opus):** `vendor_links.email_id` and `is_current` (newest per vendor and kind, set by a
trigger; older ones shown as history), `emails.files_scanned_at` as the queue. The rules are in
`supabase/functions/_shared/offerFiles.ts`: from offers mail every document (PDF, spreadsheet, Word) and
real pictures (not signature logos), from other mail only files named price list, catalog, specials or
order form; links in offers mail that are PDFs/spreadsheets or say catalog, price list, line sheet or
order form. Files over 15 MB stay in the email. gmail-sync saves a few emails a minute, newest first;
mail filed later (a sender answered in the review queue) is picked up the same way.

## 3. Five ways an order starts, one order record
Every order is one `orders` row with `order_lines` (vendor_item_id = the Vendor ID, description,
quantity, unit_cost, extended, program_id, notes). Sources, recorded in `orders.source`:
1. **sales_report**: built from a sales report (strategy Stage 1): the report's items, Vendor IDs and
   suggested quantities become the lines; the buyer edits before placing.
2. **order_writer**: a vendor's own order sheet, filled by the buyer. It arrives three ways: uploaded,
   picked off the email it came on (section 2 saved it as `order_form`), or downloaded from the WWD
   portal (many vendors put their order writers there at show time). VMS reads the filled sheet
   (XLSX/PDF) into lines with the vendor's prices and show specials as printed, and keeps the sheet
   attached as the source document.
3. **email**: a plain email we sent ("please send 6 of 83069 and 12 of 44029"). VMS reads Sent mail
   to vendors and **proposes** an order with those lines in the review queue; a person confirms. It
   never creates an order from an email on its own.
4. **manual**: the "Create an order" button. A form with everything a vendor needs: items with Vendor
   IDs, quantities, costs, ship-to store, requested ship date, PO number, terms, the program it is
   under, notes. Then pick the recipient from the vendor's contacts and send from orders@ with the
   sender's signature; the email and the order are saved together.
5. **after_the_fact**: typed in for an order placed by phone or at a show booth; attach what exists.

## 4. The Lightspeed PO is the stamp
When the order is placed, VMS creates the PO in Lightspeed through the API and writes back
`po_number`, `placed_at`, `placed_by_id`, `program_id`. The sales report or order writer stays attached
as the source; the PO and its lines are what every later check runs against. Until the Lightspeed
connection exists, "Mark as placed" does the stamp by hand with the PO number typed in.

## 5. Sending the order
On the order page, one button: **Send to vendor**. Pick the contact (from the vendor's contacts, the
rep group, or type an address), choose the attachment: the vendor's own filled order writer when that is
what they want, otherwise a clean PO PDF generated by VMS (store ship-to address, Vendor IDs, quantities,
costs, program, requested ship date, freight routing instructions from the vendor record, our account
number). Sent from orders@ with the sender's signature; the thread is owned by the sender, status
"waiting on vendor", follow-up nudge after 5 days (see `docs/gmail-connection.md`).
If the order was placed through the WWD portal or with a rep instead, mark it "placed via portal" or
"placed with rep", attach the document, and VMS still knows it was placed.

## 6. Confirmation check
A confirmation or invoice in Needs attention is matched to an order by PO number (exact match attaches
on its own) or by vendor plus date (one click to attach). Then VMS compares line by line: items,
quantities, unit costs, missing or substituted items, backorders, ship date, freight, terms. On the
order page: a differences table, green when all matches. Unit cost changes go to
`vendor_sku_cost_history` (spec §4) for the cost trend report. On differences, VMS drafts the email to
the vendor in Dana's voice (learned from the mailbox, spec §6), assigned to the order's owner as a draft
to edit or send, never sent on its own. Orders without lines (the old spreadsheet ones) get the header
check only: totals, dates, freight.

## 7. Receiving against the same lines
Check-in (strategy Phase 4) reads the packing slip or the counted quantities against the order lines;
shortages, damage and wrong items become the accuracy signals on the vendor scorecard and, when a
credit is due, a claim with a follow-up date.

## Build order
Mail views and file saving (section 1, 2) → order lines and the five sources with the manual form and
order-writer reading (3, 4 by hand, 5) → confirmation check (6) → the Lightspeed PO (4 by API) once the
connection exists → check-in (7). Each piece ships with tests and a decisions-log line.
