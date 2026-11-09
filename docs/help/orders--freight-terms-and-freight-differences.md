---
title: Freight terms from email and freight differences
section: Orders
keywords: free freight, freight terms, review card, put it on this order, not for an order, freight difference, invoice freight, freight credit, quoted freight, half freight, capped freight, free over, which order
who: Admin, managers and buyers
---
Each order can have its own freight terms. Free freight on the last order does not mean free freight on this one. VMS reads the terms from the vendor's emails and checks every invoice against them.

## Where the terms come from
1. Claude reads vendor and rep emails about freight: free freight, free over an amount, half freight, freight capped at a percent, freight charged, or a freight amount the vendor quoted.
2. Each one becomes a card in **Review › Freight** named **Freight terms from email**. It shows their exact words, **Their email of** a date (click it to read the email), the order VMS thinks it is for, and the vendor's other orders under **A different order**.
3. Click **Put it on this order** next to the right order, or **Not for an order** if it isn't about one of our orders. Nothing changes on an order until you click.
4. The order's **Shipping** box then shows the terms and **From the vendor's email of** a date, one click to the email.
5. No card is made when the order already says the same thing, or when the same words already have a card (a reply or a forward repeats them). Freight prices from our own emails (our carriers' rates) and promotions sent to all customers don't make cards. A card closes itself if someone sets the order's freight the same way in the **Shipping** box.
6. A PO only matches an order of that vendor, a brand they sell, or a vendor of the same rep group.

## Freight differences on an invoice
When an invoice charges freight that doesn't match the order's terms, the vendor's quote or cap, or the vendor's free-freight rule, VMS makes a task named **Freight on … invoice …: charged …**.
1. Click **Go to it: Open the email to send**. The email to the vendor is written, with the invoice attached.
2. Check it and click **Send**.
3. The task becomes **Waiting for …** and stays open.
4. It closes on its own when the vendor answers in that conversation or the credit comes in.

## Good to know
- A freight difference is not handled until the vendor has been emailed and has answered (or the credit came).
- If the order's terms are changed before the email is sent and the invoice now fits, VMS removes the email and closes the task.
