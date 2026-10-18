---
title: Run a sales report from Lightspeed
section: Reports
keywords: sales reports, Lightspeed, LS, vendor report, category report, size summary, stores, date range, spec v49, Analytics, discontinued, do not reorder, DNR, out of stock, replacement, item notes
who: Admin, managers and buyers run them; everyone can download them
---
The **Sales Reports** page builds vendor and category reports straight from Lightspeed, formatted by the sales report spec, with no export to upload. VMS keeps its own copy of LS's items, stock and sales, brought up to date every minute.

## How to
1. Click **Sales Reports** in the menu, or **Reports** on a vendor's line in the ordering card (the vendor is then already picked).
2. Choose the report: **Vendor report** for one vendor, or several side by side (Paricon plus Slippery Racer); **Category report** for every vendor in a category, to catch the same item bought from two vendors.
3. Pick the vendor(s) and, if you want, a category to narrow to (WFS winter only). For a category report, pick the category; it includes everything under it.
4. Choose the stores: **all stores together** (one Sold and one In Stock column), **kept apart** (a Sold and In Stock column per store, then the combined Need), or **one store**.
5. Pick the period. **Last 12 months** is the default; or a date range.
6. Click **Run the report**. The report opens on the page, tab by tab, and is filed: a vendor report under that vendor's **Sales reports** (and it feeds the **Suggested order**), a category report under Reports here and under every vendor that appears on its Active tab, so it is on each vendor's page too. Nothing downloads unless you click **Download**.
7. **Save settings** keeps the choices under a name, so next time it is one click. Every run stays in the **Reports run** list with **Open** and **Download**.

## Good to know
- **Discontinued, do not reorder, out of stock and replacements** come straight from Lightspeed's item name and Note. A name starting with * is discontinued and shows in salmon with no Need; when its LS note says "REPLACED WITH" a Vendor ID that is on the report, that replacement row says **REPLACES …**, its **ORDER** box starts with the carried need, and it is the item to order. A chain is followed to the end: if A was replaced by B and B by C, A's need lands on C and both notes say so. A name starting with ** is **DO NOT REORDER** (also salmon, no Need). A note saying "OUT OF STOCK AT VENDOR …, BACK …" shows in light blue with the back date. Every other LS note is quoted in **NOTES**, and all of these are on the **Flags** tab.
- **A discontinued item with no replacement we can use** (none noted, one not in Lightspeed, or a chain that dead-ends) is a decision: its **NOTES** says "DISCONTINUED: no replacement on file — decide on the Review tab (Find replacement or Don't need)" and the words are a link. Click it in the viewer and the item's card opens on top of **Review queue** › **Unavailable items** (one card per item, for whoever ran the report). Once decided, the next report says so instead: "a replacement is being sourced", "not needed", or the replacement with the need carried over. See *Unavailable items* under Review queue.
- Two columns after NEED: **ON ORDER** (already coming in on open orders, with the order and ship date in Notes) and **NEED AFTER ORDERS**. See "Add to an order that has not shipped".
- The report follows spec v49 exactly: Size Summary, By Category, By Vendor (category reports) or By Description (vendor reports), Flags, Active, No Data, Archived, and Archived – No Sales (Ignored). File names carry the initials of whoever ran it.
- The Size Summary groups by gender, subcategory and size. Spelling variants of one size in LS (SZ 8, SIZE 8) are one row, with a note saying what was merged.
- Stock is as of the last item pass (every six hours); sales are minutes behind. The line at the top of the page says how fresh the copy is and how far back the history goes: the last two years came first, the older years back to the start of Lightspeed (2020) follow, so a big snow year can be compared with a slow one.
- SLH is a separate Lightspeed account and is not in these reports.
- LS Analytics stays on until the new reports are proven; run both for a while and compare.
