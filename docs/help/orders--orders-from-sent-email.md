---
title: Orders we email to vendors are added automatically
section: Orders
keywords: sent order, email order, order writer, PO, placed, early buy, attachment, order from email, automatic
who: Everyone
---
When someone emails an order to a vendor (from orders@ or their own VMS mailbox), VMS adds it as an order by itself. Nobody needs to type it in.

## How it works
1. Claude looks at the mail we send and picks out the emails that place an order (an order writer, PO or list of items, in the email or attached).
2. It reads the order: PO number, items and quantities, costs, total, ship date and who placed it (from the signature).
3. If the order is already in VMS (same PO, or same vendor, date and total), the email, its file and its items are added to that order.
4. If not, it is added as a new order, status **Open** (it shows under **Placed** on the Ordering card), with the file in the vendor's **Our orders** folder.
5. When the vendor's confirmation comes in, Claude compares it with this order, and the LS PO is drafted once it is confirmed.

## Good to know
- Orders sent from someone's own mailbox (like jarrett@) are read too; only the order itself is added, not the email.
- Orders sent more than 4 months ago that were not in VMS are added with the note "Added from sent mail, check status." Check whether they have arrived and update their status.
- Order writer spreadsheets, PDFs and pictures are all read.
