---
title: Delivery receipts
section: Freight
keywords: delivery receipt, proof of delivery, POD, XPO, received date, which vendor shipped it, PRO number
who: Admin, managers and buyers
---
When a carrier emails a delivery receipt (subject like "Delivery Receipt" or "Proof of delivery"), Claude reads it and files it for you.

## What happens on its own
- The shipper on the receipt tells VMS the vendor; the PO number on it finds the order.
- The email is filed to that vendor, and the PDF goes into the vendor's and the order's files as "Delivery receipt".
- If the order had no received date, it gets the delivered date.

## When Claude cannot tell the vendor
1. A card appears in the **Review queue** for the carrier's owner: the carrier, the PRO number, the delivered date, the shipper and any PO.
2. Click **Open the email and receipt** to look at it.
3. In **Which vendor shipped it?**, pick the vendor. The email and receipt are filed to that vendor (and its order by PO).

## Good to know
- Delivery receipts are never treated as freight bills.
