---
title: How Claude checks a confirmation
section: Order paperwork
keywords: confirmation check, compare, confirmation vs our order, differences, price, quantity, ship date, mismatch
who: Everyone
---
When a vendor's confirmation comes in, Claude compares it with what we ordered and lists every difference.

## What Claude compares it with
Claude uses the first of these it can find:
1. **Our order** or the **LS PO** on file for the order.
2. The PO we emailed the vendor from orders@.
3. The order lines in VMS, or the order record itself (total, dates, freight).

## What you get
- A **Summary**, green when everything matches, red when there are issues, with each issue listed.
- A table of every item and field: **What**, **We ordered**, **Confirmation**, and **OK** (a tick or a cross). Rows that differ are shaded red.
- With issues, an email Claude drafted to the vendor.

## Good to know
- The top of the check page shows **Compared with:** and what Claude used, so you know what it looked at.
- An order shipped in parts can have several confirmations; Claude takes the others into account.
- When you finish looking at a confirmation, an Open or Awaiting confirmation order becomes **Confirmed**.
