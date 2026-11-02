---
title: Match a freight bill to vendors and orders
section: Freight
keywords: match, confirm, shipper, vendor, order, freight cost, line, undo, freight bill lines, PO, reference, ship date, tracking
who: Admin, managers and buyers
---
A freight bill can cover several shipments from different vendors. Each line is one shipment; you tell VMS which vendor shipped it and, if you know it, which order it was for.

## How to
1. Open the bill from the **Freight** page (the **To match** tab).
2. For each line, look at the shipper, date, pieces, weight and tracking numbers.
3. If no vendor is filled in, click **Which vendor shipped it?** and pick the vendor. To change a vendor Claude picked, click its name and pick another.
4. In the order box, pick the order (date, PO, amount), or leave **No order (vendor only)**.
5. Click **Confirm**. The freight is now on that vendor (and order).
6. Made a mistake? Click **Undo** on the line.
7. When every line is done, click **Mark done** at the top.

## Good to know
- Claude reads the bill and fills in what it can; you check and confirm.
- VMS confirms a line by itself when it can prove the order: our PO is printed on the bill (Ref # or PO, like PARICON1-19-26); the tracking number (even written with spaces) is in the vendor's own shipping email, tied to the order directly or through the invoice attached to it; a reference on the bill is the vendor's own invoice number filed on an order (Cal Mango #48571); or the vendor's one invoice dated the ship day is filed on an order. A bill whose lines are all proven leaves **To match** on its own. When a shipment comes as several packages, confirming one package puts the others from the same shipper and day on the same order.
- Otherwise it only suggests the vendor's order placed closest before the ship date (the order date, or a date in the PO like 1-19-26). It never suggests an order placed after the shipment or a cancelled one.
- An invoice fee on the bill is added to the line for the biggest order.
- If the lines do not add up to the bill total, the total shows in red ("bill says ...").
- Once a line is confirmed, the bill is also filed in the vendor's Documents (Shipping) and on the matched order.
