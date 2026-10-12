---
title: Import Bill.com payments
section: Payments
keywords: Bill.com, billcom, payments export, Excel, CSV, mark paid, confirmation number, history
who: Admin and managers
---
Load Bill.com's Payments export and VMS marks the matching freight bills and vendor orders paid.

## How to
1. In Bill.com, go to Payments and export to Excel or CSV.
2. In VMS, click **Payments** in the menu, then **Choose the export** in the Bill.com box and pick the file.
3. Check the preview. Each row shows the date, method, who was paid, the invoice, the amount and what it matches: **Freight bill ...**, **Order ...**, **History only** or **Already imported**.
4. Untick any row you do not want.
5. Click **Import** (the button shows how many).

## Good to know
- A freight bill is found by billing company and invoice number, else the only unpaid bill for that amount. An order is found by invoice or PO number, else the vendor's only unpaid order for that amount.
- Matched items are marked paid via Bill.com with the confirmation number.
- Payments with no match are kept as history on the vendor. Payments already imported are skipped.
