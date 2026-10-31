---
title: Shipment details and the freight quote from the vendor
section: Freight
keywords: shipment details, freight quote, form, link, pallet, LTL, parcel, UPS, FedEx, confirmed order, Trevor, 3 business days, follow-up, free freight, half freight, capped freight, Reference 1
who: Everyone
---
The moment an order is confirmed, VMS emails the vendor from orders@ as Trevor (Inventory & Logistics Specialist). Vendors who charge freight get a link to a short form for the shipment details and their quote; vendors who agreed to free, half or capped freight are asked to confirm it. Nothing ships until the freight is OK'd.

## What goes out
- **We pay freight:** the shipment details email. It says we now require a freight quote before anything ships, unless they pay the full freight including backorders. Paying vendors just reply to say so; the others click the link.
- **Free freight agreed, shown on the confirmation:** nothing goes out. The order shows "The vendor confirmed these terms on the confirmation."
- **Free freight agreed, not on the confirmation:** a short email asking them to confirm this order and any backorders ship free. No form link, so nobody thinks they can fill it in and charge us.
- **Half or capped freight agreed, not on the confirmation:** an email asking them to confirm the terms, with the form link so we see our share before it ships.
- **The check emails never go out on their own.** Trevor gets a task **Check freight on the confirmation: [vendor], PO [number]** and the email waits in his Drafts. He opens the order and reads the confirmation: if the terms are there, he clicks **The confirmation shows the agreed terms** in the order's Shipping box and the task closes with no email; if not, **Go to it** on the task opens the order, and the email is in Mail › Drafts to send as is or change.
- It goes to whoever sent us the confirmation, with the vendor's Shipping contact and our rep copied. Free-freight web-order vendors (Kelli's) and paperwork-only vendors (Rossignol) are skipped.

## The form
1. The vendor picks **Pallet (LTL)** or **Parcel (UPS / FedEx)**; only that set of questions shows.
2. Pickup location, the contact there, hours and days pickups are allowed, the ready date, and for pallets whether it is residential, needs a lift gate or is limited access.
3. One block per pallet or package size with **Add another**: pieces, weight, sizes, class and NMFC if known, stackable and hazmat (pallets), large package and additional handling (parcel).
4. Their freight quote and anything else we should know. **Send to Shaver Lake Sports** finishes it.
5. The answers land on the order's **Shipment details** box and become a freight quote under **Freight › Freight quotes**, with a task for Trevor to price it (Priority One for pallets, WWEX/UPS for parcel) and approve the cheaper one. A pickup contact we didn't have is saved on the vendor as the Shipping contact.

## If they reply by email instead
Claude reads the reply. "We ship free" or "yes, those terms" confirms the terms on the order. Shipment details written in the email land the same way the form would. "Freight will be charged" on an order where we agreed free, half or capped goes to whoever placed the order as a task, with an FYI task for Trevor, and the conversation moves to the buyer.

## Nothing back in 3 business days
Trevor gets a task **No shipment details yet: [vendor], PO [number]** with the follow-up email ready in his Drafts. **Go to it** opens the email; send it as is or change it. The task finishes itself when the form or a reply with the details comes in.

## Where to see it
- **Freight › Shipment details**: **See the form vendors get** opens the form as a preview (nothing saved). The list shows every request with sent, opened and answered dates, the method and the status. **Waiting** shows what is still with vendors, red past 3 business days. **Send now** sends one that is ready (for example an order confirmed before this was built, or one that waited for an email address).
- The order page's **Shipment details** box and each vendor's page show the same.
- The dashboard's **Freight bills** box has a line with how many are waiting.

## Good to know
- Set what was agreed on the order's **Shipping** box: free (and why), they cover half, capped at a percent, or we pay. That is what the confirmation is checked against. **The confirmation shows the agreed terms** there records that a person checked it.
- Every UPS shipment booked through WWEX carries our PO number in **Reference 1**.
- This replaces the earlier "ask for their freight quote" email: one email per confirmed order, not two.
