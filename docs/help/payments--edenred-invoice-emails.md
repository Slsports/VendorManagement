---
title: Edenred invoice emails
section: Payments
keywords: Edenred, emailed invoices, WWD invoice, Worldwide, invoice PDF, Invoice Summary, filed invoices
who: Admin and managers
---
Edenred (Worldwide's invoice site) emails WWD invoices to orders@ in groups, one PDF per invoice. VMS files them for you.

## What VMS does with each PDF
1. Claude reads the numbers: the **Worldwide Invoice Number** on the Invoice Summary page, the vendor's invoice number, the amount and the dates.
2. VMS finds that WWD invoice. A Worldwide number VMS hasn't seen yet is added as a new WWD invoice.
3. The PDF goes into that vendor's documents: **Invoices** (or **Credits**) for the invoice's year, tied to the order when VMS knows it.
4. In the email, each PDF then shows **Saved to Invoices › [year]**.

## Good to know
- No duplicates: if that invoice is already in the vendor's documents (same invoice number), the email is linked to the one on file instead.
- A PDF without the Invoice Summary page is matched by the vendor's invoice number and amount.
- Files VMS can't place stay in the email, and you get a task, **Edenred: N invoice files VMS couldn't place**, that opens the email.
- Nothing already in VMS is overwritten; VMS only fills in blanks (like a missing PO).
