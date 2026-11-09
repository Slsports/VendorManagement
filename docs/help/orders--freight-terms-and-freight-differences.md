---
title: Freight terms from email and freight differences
section: Orders
keywords: free freight, freight terms, freight difference, invoice freight, freight credit, quoted freight, half freight, capped freight, free over, which order
who: Admin, managers and buyers
---
Each order can have its own freight terms. Free freight on the last order does not mean free freight on this one. VMS reads the terms from the vendor's emails and checks every invoice against them.

## Where the terms come from
1. Claude reads vendor and rep emails about freight: free freight, free over an amount, half freight, freight capped at a percent, freight charged, or a quoted freight amount.
2. The terms go on the order the email is about (by its PO, or the one order in that conversation). The order's **Shipping** box shows them with **From the vendor's email of** a date. Click it to open the email.
3. A newer email about the same order replaces the older terms.
4. Terms a person saved on the order stand. If an email says something different, you get a task named **Freight terms on … the email and the order differ**.

## Which order?
When VMS can't tell which order an email means, you get a task named **Which order?** Open it, read the quote and click **This order** next to the right one. Click **None of these** if the terms aren't for an order. The task closes itself.

## Freight differences on an invoice
When an invoice charges freight that doesn't match the order's terms, the vendor's quote or cap, or the vendor's free-freight rule, VMS makes a task named **Freight on … invoice …: charged …**.
1. Click **Go to it: Open the email to send**. The email to the vendor is written, with the invoice attached.
2. Check it and click **Send**.
3. The task becomes **Waiting for …** and stays open.
4. It closes on its own when the vendor answers in that conversation or the credit comes in.

## Good to know
- A freight difference is not handled until the vendor has been emailed and has answered (or the credit came).
- If the order's terms are changed before the email is sent and the invoice now fits, VMS removes the email and closes the task.
