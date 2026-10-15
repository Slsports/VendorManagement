---
title: How Claude checks a confirmation
section: Order paperwork
keywords: confirmation check, compare, sales report, Order column, Need, report used, no order, confirmation vs our order, differences, price, quantity, ship date, mismatch, email conversation, web orders, Kelli's
who: Everyone
---
When a vendor's confirmation comes in, Claude compares it with what we ordered and lists every difference.

## What Claude compares it with
Claude uses the first of these it can find:
1. **Our order** or the **LS PO** on file for the order.
2. The PO we emailed the vendor from orders@ (a PDF, spreadsheet, or a photo or screenshot of the order).
3. The order lines in VMS. An order you typed into an email has its sizes, colors and amounts saved as the order lines, so this is what it is compared with.
4. When there is no order, or the order has no item list or order document: the **sales report** we ordered from. Claude compares each item on the confirmation with the report's **Order** column, or **Need** when nothing was typed in Order, and says what the confirmation got right, what's missing and what's extra or a different quantity.
5. Otherwise the order record itself (total, dates, freight).

## Which sales report
- The one picked as **Report used** on the order, or ticked **Used to place the order** in the vendor's **Sales reports** folder.
- If none is ticked, the report closest before the confirmation's date. The check then says **not ticked, please confirm**: click **Yes, we ordered from this report**, or tick the right one in Sales reports and click **I ticked another one: check again**.

## What you get
- A **Summary**, green when everything matches, red when there are issues, with each issue listed.
- A table of every item and field: **What**, **We ordered**, **Confirmation**, and **OK** (a tick or a cross). Rows that differ are shaded red.
- With issues, an email Claude drafted to the vendor. Claude reads the whole email conversation first, so it leaves out what was already agreed or answered (an item taken off, a discount promised, a ship date already asked for).
- **The email conversation** on the page, so you can see what Claude read.

## Good to know
- The top of the check page shows **Compared with:** and what Claude used, so you know what it looked at. Click **Our order in VMS** there to see what we ordered, line by line.
- Pictures sent with a typed order (the products or the design) are not the order: they go to the vendor's **Images** folder, not **Our orders**.
- An order shipped in parts can have several confirmations; Claude takes the others into account.
- A confirmation with no PO of ours gets a **Create PO** task (see "A confirmation with no PO").
- When you finish looking at a confirmation, an Open or Awaiting confirmation order becomes **Confirmed**.
- Vendors ticked **Web orders, no confirmation needed** (like Kelli's) get no confirmation check: their order email confirms the order. Their invoices are still checked, but items they couldn't ship are just noted, since they aren't billed.
