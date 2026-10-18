---
title: Vendor sales reports
section: Reports
keywords: sales report, used to place the order, report used, LS Analytics, export, Need, Order, 365 days, vendor report, category report, sales reports folder, run report
who: Everyone
---
VMS builds a vendor's sales report straight from Lightspeed, following Dana's Sales Report Formatting Spec, and files it on the vendor's page.

## How to
1. On the vendor's page, click **Run report** in the **Ordering** box. VMS runs the last 12 months, all stores together, and says when it is filed (or why it couldn't: a vendor not tied to Lightspeed needs **In Lightspeed as** set first).
2. For another period, stores kept apart, or several vendors at once, click **Reports** (the Sales Reports page with the vendor picked).
3. A historical LS Analytics export can still be filed with **Upload sales report** (see "Upload a sales report").
4. To open one: open the vendor, find the **Documents** box, and open the **Sales reports** folder.

## What is in a report
- Tabs such as **By Category**, **By Description**, **Active**, **No Data**, **Flags** and **Archived** (plus a Size Summary for sized items).
- For each item: Vendor ID, description, cost, last sold date, sold, in stock, **Need** (sold minus stock) and a yellow **Order** column to fill in.
- File names start with the initials of who ran it, for example DP_10-11-26_PARICON_SALES 365 DAYS.

## Used to place the order
In the **Sales reports** folder, tick **Used to place the order** on the report you ordered from, or pick it as **Report used** on the order. When a confirmation comes in with no order, or the order has no item list, Claude checks it against that report's **Order** column (or **Need** when Order is blank). Ticking one unticks the vendor's other reports from the same season. Filing or ticking a report sends that vendor's waiting confirmations (no order, no item list, or an unticked report) back to Claude to compare again.
