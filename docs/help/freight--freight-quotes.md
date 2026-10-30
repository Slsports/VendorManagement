---
title: Approve a freight quote
section: Freight
keywords: freight quote, quote, Priority One, P1, WWEX, UPS, pallet, parcel, approve, cheapest, routing, ship, cartons, pallets, which order, Trevor
who: Admin, managers and buyers
---
No order ships until its freight quote is approved. When a vendor emails a freight quote, VMS ties it to the order and gives Trevor a task: **Get freight quote: [vendor], PO [number] – Pallet, P1** (or **– Parcel, WWEX/UPS**), due the next business day.

## How to
1. Open the task, or click **Freight**, then **Freight quotes**.
2. Click the vendor to open the quote. You see the vendor's price, the shipment details (cartons or pallets, sizes, weights, ship-from, ready date) and the email conversation.
3. Check **Pallet (P1)** or **Parcel (WWEX/UPS)** under **Our price**. VMS picks it from the vendor's quote; click the other one if it's wrong.
4. Pallets: get a Priority One price. Parcel (boxes): get a UPS price through WWEX. Type it in the box.
5. Click **Approve** on the cheaper one (it is marked **cheapest**). The task is done and the price goes on the order.
6. If it says **Which order?**, pick the order from the list and click **Use this order** first.

## Good to know
- VMS finds the order by our PO number, then the vendor's own order or invoice number, then the conversation, then Claude compares the quote with the vendor's open orders. If it still can't tell, it asks you.
- **Save prices** keeps the prices without approving. **Not a freight quote** clears it if Claude got it wrong. **Change it** opens an approved quote again.
- The order page shows **Waiting on freight quote** until one is approved.
- Orders that shipped without an approved quote are listed in red at the bottom of the Freight quotes page.
- Free-freight orders and web orders (like Kelli's) don't need a quote.
- A quote can come from the shipment details form the vendor filled in (see "Shipment details and the freight quote from the vendor"); it shows the form's answers instead of an email.
- When an invoice comes for an order with an approved quote, Claude checks the invoice's freight against it.
