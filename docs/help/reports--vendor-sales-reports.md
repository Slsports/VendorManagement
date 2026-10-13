---
title: Vendor sales reports
section: Reports
keywords: sales report, used to place the order, report used, LS Analytics, export, Need, Order, 365 days, vendor report, category report, sales reports folder
who: Everyone
---
Claude turns a raw LS Analytics sales export into a formatted sales report, following Dana's Sales Report Formatting Spec, and files it on the vendor's page.

## How to
1. Run the sales export in LS Analytics for the vendor.
2. On the vendor's page, click **Upload sales report** in the **Ordering** box and pick the file (see "Upload a sales report").
3. VMS formats it and saves it to the vendor's Documents, in the **Sales reports** folder, and opens the suggested order.
   Category reports, or a file to split across many vendors at once, can still be done by asking Claude.
4. To open one: open the vendor, find the **Documents** box, and open the **Sales reports** folder.

## What is in a report
- Tabs such as **By Category**, **By Description**, **Active**, **No Data**, **Flags** and **Archived** (plus a Size Summary for sized items).
- For each item: Vendor ID, description, cost, last sold date, sold, in stock, **Need** (sold minus stock) and a yellow **Order** column to fill in.
- File names start with the initials of who ran it, for example DP_10-11-26_PARICON_SALES 365 DAYS.

## Used to place the order
In the **Sales reports** folder, tick **Used to place the order** on the report you ordered from, or pick it as **Report used** on the order. When a confirmation comes in with no order, or the order has no item list, Claude checks it against that report's **Order** column (or **Need** when Order is blank). Ticking one unticks the vendor's other reports from the same season. Filing or ticking a report sends that vendor's waiting confirmations (no order, no item list, or an unticked report) back to Claude to compare again.
