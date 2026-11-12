---
title: Shipment details and the freight quote from the vendor
section: Freight
keywords: shipment details, send the shipment details email, drafts, freight quote, form, link, pallet, LTL, parcel, UPS, FedEx, confirmed order, Trevor, 3 business days, follow-up, free freight, half freight, capped freight, Reference 1
who: Everyone
---
The moment an order is confirmed, VMS writes the email to the vendor and puts it in Trevor's Drafts (Inventory & Logistics Specialist). Nothing goes until Trevor presses **Send**. Vendors who charge freight are told the 10% rule (Dana, Nov 12): if the freight is 10% or less of the merchandise cost they ship and add it to the invoice; if it is over 10% they hold it and use the link to a short form for the shipment details and their quote. Vendors who agreed to free, half or capped freight are asked to confirm it.

## What goes out
- **We pay freight:** the shipment details email. Trevor gets a task **Send the shipment details email: [vendor], PO [number]**; **Go to it** opens the email in Mail › Drafts. He checks it and presses **Send**, and the task closes. The email says: 10% or less of the merchandise cost, go ahead and ship and invoice the freight; over 10%, hold it and fill in the form; paying the full freight, just reply. Our routing letter is attached.
- **Free freight agreed, shown on the confirmation:** nothing goes out. The order shows "The vendor confirmed these terms on the confirmation."
- **Free freight agreed, not on the confirmation:** a short email asking them to confirm this order and any backorders ship free. No form link, so nobody thinks they can fill it in and charge us.
- **Half or capped freight agreed, not on the confirmation:** an email asking them to confirm the terms, with the form link so we see our share before it ships.
- **The check emails never go out on their own.** Trevor gets a task **Check freight on the confirmation: [vendor], PO [number]** and the email waits in his Drafts. He opens the order and reads the confirmation: if the terms are there, he clicks **The confirmation shows the agreed terms** in the order's Shipping box and the task closes with no email; if not, **Go to it** on the task opens the order, and the email is in Mail › Drafts to send as is or change.
- It goes to whoever sent us the confirmation, with the vendor's Shipping contact and our rep copied. Free-freight web-order vendors (Kelli's) and paperwork-only vendors (Rossignol) are skipped.

## The form
At the very top, in red: "NOTE: IF FREIGHT IS FREE OR YOUR RATE QUOTE CAME IN AT 10% OR LESS YOU ARE AUTHORIZED TO SHIP AND YOU DO NOT NEED TO FILL THIS OUT."
1. The vendor picks **Pallet (LTL)** or **Parcel (UPS / FedEx)**; only that set of questions shows.
2. Pickup location, the contact there, hours and days pickups are allowed, the ready date, and for pallets whether it is residential, needs a lift gate or is limited access.
3. One block per pallet or package size with **Add another**: pieces, weight, sizes, class and NMFC if known, stackable and hazmat (pallets), large package and additional handling (parcel).
4. Their freight quote and anything else we should know. **Send to Shaver Lake Sports** finishes it.
5. The answers land on the order's **Shipment details** box and become a freight quote under **Freight › Freight quotes**, with a task for Trevor to price it (Priority One for pallets, WWEX/UPS for parcel) and approve the cheaper one. A pickup contact we didn't have is saved on the vendor as the Shipping contact.

## The form link in the routing letter
The routing letter prints one link to the same form: **vms.shaverlakesports.com/ship/new**, so anyone the letter is passed to can use it. It starts with **Our PO number** and **Your company name**. When the PO matches one of our orders, the answers land on that order exactly as from the order email. When it doesn't, the freight quote waits on **Freight › Freight quotes › Which order?** and Trevor gets a task to pick the order. Nothing about our orders shows to whoever opens the link.

## If they reply by email instead
Claude reads the reply. "We ship free" or "yes, those terms" confirms the terms on the order. Shipment details written in the email land the same way the form would. "Freight will be charged" on an order where we agreed free, half or capped goes to whoever placed the order as a task, with an FYI task for Trevor, and the conversation moves to the buyer.

## Nothing back in 3 business days
Trevor gets a task **No shipment details yet: [vendor], PO [number]** with the follow-up email ready in his Drafts. **Go to it** opens the email; send it as is or change it. The follow-up repeats the 10% rule. The task finishes itself when the form or a reply with the details comes in, or when the order ships.

## Where to see it
- **Freight › Shipment details**: **See the form vendors get** opens the form as a preview (nothing saved). The list shows every request with sent, opened and answered dates, the method and the status. **Waiting** shows what is still with vendors, red past 3 business days. **Send now** sends one that is ready, the same as sending it from Drafts.
- The order page's **Shipment details** box and each vendor's page show the same.
- **Shipped without an approved freight quote** (Freight › Freight quotes) leaves out an order whose freight is known and 10% or less of the merchandise.
- The dashboard's **Freight bills** box has a line with how many are waiting.

## Good to know
- Set what was agreed on the order's **Shipping** box: free (and why), they cover half, capped at a percent, or we pay. That is what the confirmation is checked against. **The confirmation shows the agreed terms** there records that a person checked it.
- Every UPS shipment booked through WWEX carries our PO number in **Reference 1**.
- This replaces the earlier "ask for their freight quote" email: one email per confirmed order, not two.
