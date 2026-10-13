---
title: Orders from NuORDER, Faire and web stores are added automatically
section: Orders
keywords: NuORDER, Faire, MarketTime, Elastic, web store, online order, order submitted, order received, order confirmation, rep contact, automatic
who: Everyone
---
When NuORDER, Faire, MarketTime or a vendor's web store emails us that our order was submitted or received, VMS adds the order by itself.

## How it works
1. Claude reads the email: which vendor the order is with, the order number, items, total and ship date.
2. If the order is already in VMS (same PO or order number, or the same vendor, date and total), the email and its items are added to that order. An order typed in without an amount gets the amount.
3. If not, it is added as a new order, status **Open**, with the note "Added from NuORDER order email" (or the service's name).
4. The vendor's contact named in the email (like "Gold Medal International's Contact Information: Jessica Kane") is added to the vendor's **Reps & contacts** as a **Rep**, and shows as who took the order.

## Good to know
- Shipping notices, invoices, sales and invitations are skipped.
- If the vendor is not in VMS yet, no order is added.
- Contacts are only saved from Orders mail and shared conversations, never from someone's private mailbox. Orders from private mail are still added.
- Orders older than 4 months that were not in VMS get "check status" in the note.
