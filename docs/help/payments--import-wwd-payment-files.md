---
title: Import WWD payment files
section: Payments
keywords: WWD, Worldwide, Payments Due, future payments, discount date, Disc Date, Disc Avail, reminders, Payment History, EdenRed, payment sheet, scan, import, PB number, WWD payment #, xls, N/D Freight, NDOF, no discount on freight
who: Admin and managers
---
Worldwide's portals never show the whole picture, so VMS puts it together from several files: the Payment History export, the EdenRed invoice export, Edenred's invoice line export, your own payment sheets, scans of printed sheets, and WWD's **Payments Due** list.

## How to
1. Click **Payments** in the menu.
2. In **Worldwide (WWD) payments**, click **Choose files** and pick any mix of files: Excel (including the History "xls"), Word copies of your sheets, or PDFs and photos of printed sheets.
3. Each file is listed with what VMS took it for (**Payment History**, **EdenRed invoices**, **Payment sheet**, **Payments due (not paid yet)** or **Scanned sheet (read by Claude)**) and how many payments or invoices it holds. Scans take Claude about a minute each.
4. Click **Add more files** for more. Check the summary: invoices (how many new), payments (how many new), and vendor names found in VMS.
5. Click **Import**. A green note says what was added and how many orders were marked paid.

## WWD's Payments Due list
- Copy WWD's list of bills not paid yet into Excel, with a title like "WORLDWIDE PAYMENTS DUE - NO PAYMENT MADE YET", or put "Payments Due" in the file name. Then upload it here like the other files.
- VMS lists it as **Payments due (not paid yet)**. Nothing on it is marked paid.
- WWD's **Date Due** replaces the due date VMS had. Bills VMS did not have yet are added.
- Each bill gets a reminder **3 days before** in your tasks:
  - a bill with a **Disc Avail** amount: "Pay … by (Disc Date) to take the $… discount"
  - other bills: "Pay … by (Date Due)"
- If the discount date passes unpaid, the reminder changes to the due date, because the discount can't be taken anymore.
- When you upload your payment sheet for a bill, its reminder closes as **Paid**.

## Good to know
- Names VMS does not know are listed after import under **WWD names to match**. Import anyway; you pick the vendor once.
- Invoices tie to orders by our PO, else the vendor's only order for exactly that amount. An order whose WWD invoices are all paid is marked paid with the WWD payment #.
- The $275 lines are WWD's monthly membership fee, filed under WORLDWIDE.
- From the EdenRed invoice export, VMS keeps the **Posted Date** as **posted to Edenred** on each WWD invoice: the day WWD posted it there, not the invoice date. It reads the AR columns (AR Terms, Hard Due Date (AR)); the AP columns are WWD's own.
- Edenred's invoice line export (**Edenred invoice lines**) fills in every WWD invoice's items, gives an order with no items its items, and keeps **No discount on freight** (Edenred's N/D Freight: Yes means the terms discount does not apply to the freight) with the freight amount it covers (Edenred's NDOF Amount), the freight, the tracking number, the **Vendor Inv #** and the **WWD Seq #**. It also marks vendors that are no longer with WWD.
- After the line export, cards come to the review queue when Edenred's freight differs from the order's, when the invoice PO doesn't match its order, or when a credit's invoice can't be told. See "WWD invoice cards".
- A WWD credit is filed in the vendor's **Credits** folder and shows on the invoice it is for.
- "Check #" in WWD is not a check; VMS calls it the **WWD payment #**.
