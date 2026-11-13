---
title: Shipment details and the freight quote from the vendor
section: Freight
keywords: shipment details, send the shipment details email, drafts, freight quote, form, link, pallet, LTL, parcel, UPS, FedEx, confirmed order, Trevor, 3 business days, follow-up, free freight, half freight, capped freight, Reference 1
who: Everyone
---
Once an order is confirmed, VMS writes the **Freight email** and puts it in Trevor's Drafts (see "The Freight email for an order"). It tells the vendor what to do for their freight terms and links to the form below for that order. Nothing goes until someone presses **Send**.

## Nothing to do for the vendor
- **Free freight shown on the confirmation:** no email; the order shows "The vendor confirmed these terms on the confirmation."
- Free-freight web-order vendors (Kelli's) and paperwork-only vendors (Rossignol) are skipped.

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
