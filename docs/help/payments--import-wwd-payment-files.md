---
title: Import WWD payment files
section: Payments
keywords: WWD, Worldwide, Payment History, EdenRed, payment sheet, scan, import, PB number, WWD payment #, xls
who: Admin and managers
---
Worldwide's portals never show the whole picture, so VMS puts it together from several files: the Payment History export, the EdenRed invoice export, your own payment sheets, and scans of printed sheets.

## How to
1. Click **Payments** in the menu.
2. In **Worldwide (WWD) payments**, click **Choose files** and pick any mix of files: Excel (including the History "xls"), Word copies of your sheets, or PDFs and photos of printed sheets.
3. Each file is listed with what VMS took it for (**Payment History**, **EdenRed invoices**, **Payment sheet** or **Scanned sheet (read by Claude)**) and how many payments or invoices it holds. Scans take Claude about a minute each.
4. Click **Add more files** for more. Check the summary: invoices (how many new), payments (how many new), and vendor names found in VMS.
5. Click **Import**. A green note says what was added and how many orders were marked paid.

## Good to know
- Names VMS does not know are listed after import under **WWD names to match**. Import anyway; you pick the vendor once.
- Invoices tie to orders by our PO, else the vendor's only order for exactly that amount. An order whose WWD invoices are all paid is marked paid with the WWD payment #.
- The $275 lines are WWD's monthly membership fee, filed under WORLDWIDE.
- From the EdenRed invoice export, VMS keeps the **Posted Date** as **posted to Edenred** on each WWD invoice: the day WWD posted it there, not the invoice date. It reads the AR columns (AR Terms, Hard Due Date (AR)); the AP columns are WWD's own.
- "Check #" in WWD is not a check; VMS calls it the **WWD payment #**.
