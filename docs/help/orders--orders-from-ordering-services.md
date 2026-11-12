---
title: Orders from NuORDER, Faire and web stores are added automatically
section: Orders
keywords: NuORDER, cancelled order, changed order, Faire, MarketTime, Elastic, web store, online order, order submitted, order received, order confirmation, rep contact, automatic
who: Everyone
---
When NuORDER, Faire, MarketTime or a vendor's web store emails us that our order was submitted or received, VMS adds the order by itself.

## How it works
1. Claude reads the email: which vendor the order is with, the order number, items, total and ship date.
2. If the order is already in VMS (same PO or order number, or the same vendor, date and total), the email and its items are added to that order. An order typed in without an amount gets the amount.
3. If not, it is added as a new order, status **Sent**, with the note "Added from NuORDER order email" (or the service's name).
4. The vendor's contact named in the email (like "Gold Medal International's Contact Information: Jessica Kane") is added to the vendor's **Reps & contacts** as a **Rep**, and shows as who took the order.

## Good to know
- Shipping notices, invoices, sales and invitations are skipped.
- **Newer email wins.** If the service later emails that the order was changed, the order's items and estimate are replaced with the new ones (retail prices and UPCs you already entered stay). If it emails that the order was cancelled, the order is marked **Cancelled** with a note naming the email, and whoever placed it gets an "FYI: order … was cancelled" task that opens the email.
- The same goes for a vendor or rep who writes that our order is cancelled.
- An order already received, entered or paid is never changed by a cancel email. If a cancel was wrong, change the status back on the order.
- If the vendor is not in VMS yet, no order is added.
- Contacts are only saved from Orders mail and shared conversations, never from someone's private mailbox. Orders from private mail are still added.
- Orders older than 4 months that were not in VMS get "check status" in the note.
