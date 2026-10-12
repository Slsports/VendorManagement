---
title: How Claude checks an invoice
section: Order paperwork
keywords: invoice check, invoice vs confirmation, billing mistake, overcharge, compare invoice, final confirmation
who: Everyone
---
When a vendor's invoice comes in, Claude compares it with the final confirmation for the order, so billing mistakes are caught before paying.

## What Claude compares it with
1. The latest confirmation for the order.
2. If there is no confirmation, what we ordered (Our order, the LS PO, or the PO we emailed).
3. Otherwise the order lines or the order record.

## What you get
- A **Summary** (green when everything matches), every item and field in a table (**What**, **Confirmation**, **Invoice**, **OK**), and a drafted email to the vendor when something is off.

## Good to know
- Orders that ship and bill in parts can have several invoices; Claude counts the other invoices on the order too.
- **Compared with:** at the top of the page says what Claude used.
