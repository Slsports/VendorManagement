---
title: Upload a sales report
section: Ordering
keywords: sales report, LS Analytics, export, upload, need, stock, spec, xlsx, formatted report
who: Admin, managers and buyers
---
Upload a vendor's sales report: the raw LS Analytics export (VMS formats it), or a report that is already formatted, like one you filled in with Order quantities (VMS files it as it is). Either way it goes in the vendor's **Sales reports** folder and VMS works out a suggested order.

## How to
1. Export the vendor's sales from LS Analytics (the usual columns: System ID, UPC, Default Vendor, Vendor ID, Description, Cost, Category, Archived, Quantity Sold, Quantity on Hand, Days Since Sold).
2. Open the vendor's page and click **Upload sales report** in the **Ordering** box (or on the vendor's row on the Ordering card).
3. Pick the file.
4. If the file holds more than one LS vendor, pick which one is this vendor.
5. Check the **Sales period (days)** (365 unless the file name says otherwise) and click **Make the report**.
6. The suggested order opens.

## An already formatted report
1. Click **Upload sales report** and pick the report (the one with tabs like Size Summary, By Category, Active, Flags).
2. VMS sees it is already formatted and says so. Click **File the report**.
3. It is filed exactly as it is, with your **Order** column and notes. Confirmations are compared with it: VMS uses the tab where you typed Order quantities.

## Good to know
- The report has the usual tabs (By Category, By Description, Active, No Data, Flags, Archived, Ignored, and Size Summary for product-line vendors), with Need in green, Order in yellow and TOTAL rows.
- The file is named like DP_10-11-26_PARICON_SALES 365 DAYS, with your initials and today's date.
- Apparel size grouping (gender and size steps in the spec) is not done automatically yet; those reports group by category.
