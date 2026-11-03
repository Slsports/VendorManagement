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
- Nothing already in VMS is overwritten; VMS only fills in blanks (like a missing PO, or the **posted to Edenred** date from the Invoice Summary page).
- Each file is saved as **date, vendor, invoice #, amount**, for example "2025-10-22 WORLD FAMOUS SPORTS 77872 $12176.85.pdf". A credit says CREDIT before its number and its amount has a minus, for example "2025-10-06 PUKA CREATIONS CREDIT 228361 -$8.00.pdf". So **Download all** on a vendor's folder gives you named files, not a pile of "Invoice.pdf".
- Older WWD invoices from **LaserVault** (before November 2025) work the same way. Email them to orders@ with **LaserVault** in the subject, 10 or 20 at a time. Each goes to its vendor's documents. A paper with no WWD number, like a vendor's credit memo, goes to the vendor named on it. A WWD freight bill for a freight company (like XPO) becomes a freight bill under that company.
