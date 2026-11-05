---
title: Orders we email to vendors are added automatically
section: Orders
keywords: sent order, revised order, re-sent order, add-on, cancel order, email order, order writer, PO, placed, early buy, attachment, order from email, automatic
who: Everyone
---
When someone emails an order to a vendor (from orders@ or their own VMS mailbox), VMS adds it as an order by itself. Nobody needs to type it in.

## How it works
1. Claude looks at the mail we send and picks out the emails that place an order (an order writer, PO or list of items, in the email or attached).
2. It reads the order: PO number, items and quantities, costs, total, ship date and who placed it (from the signature).
3. If the order is already in VMS (same PO, or same vendor, date and total), the email, its file and its items are added to that order.
4. If not, it is added as a new order, status **Open** (it shows under **Pending** on the Ordering card), with the file in the vendor's **Our orders** folder.
   The vendor is the one the email was sent to. If that address is not on file yet, Claude takes the vendor's name from the email or the order form, matches it to the vendor list, and saves the address on that vendor as an **Orders** contact so the next email matches by itself. Only when no vendor is named anywhere is the email left as "no vendor".
5. When the vendor's confirmation comes in, Claude compares it with this order, and the LS PO is drafted once it is confirmed.

## Good to know
- Orders sent from someone's own mailbox (like jarrett@) are read too; only the order itself is added, not the email.
- Orders sent more than 4 months ago that were not in VMS are added with the note "Added from sent mail, check status." Check whether they have arrived and update their status.
- **Newer email wins.** If we send a revised order or re-send it, the items on the order are replaced with the new list (retail prices, UPCs and notes you already entered stay; lines from a WWD invoice are never touched). A revised total updates the estimate.
- An add-on email ("please add these") adds only the new items to the order.
- If we email the vendor to cancel the order, VMS marks it **Cancelled** with a note. Orders already received, entered or paid are never changed.
- Order writer spreadsheets, PDFs and pictures are all read.
