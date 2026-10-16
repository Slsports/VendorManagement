---
title: Inventory checklists and counts
section: Reports
keywords: inventory, count sheet, physical count, checklist, floor, back stock, bins, total, send to LS, inventory count, Lightspeed
who: Admin, managers and buyers run checklists; people with the count ticks enter and send counts
---
An inventory checklist is the count sheet for a vendor or a category at one store: the items from Lightspeed with their current stock and blank Floor, Back stock, Bins and Total columns for the pen. Counts come back into VMS and go to Lightspeed as an Inventory Count.

## How to
1. On **Sales Reports**, choose **Inventory checklist**, pick the vendor or category and the store, and click **Run the report**. The sheet opens on the page and is filed under the vendor (folder **Inventory counts**) with a **Download** for printing. It follows the Inventory Report spec: sorted by category then description, every item included, a **Vendor ID** column next to Description.
2. Count on the printed sheet.
3. Back in VMS, open the checklist from the **Reports run** list (**Enter counts**). Type Floor, Back stock and Bins; Total adds itself, or type Total alone. Each number saves when you leave the box. A badge shows how far the count is from what LS has.
4. When the count is done, click **Send to LS**. VMS creates a new Inventory Count in Lightspeed for that store with the totals entered, named after the checklist unless you change it. Items with no total are left out.
5. In Lightspeed, open Inventory Counts to see what is missing, then reconcile there when you are ready. VMS never reconciles.

## Good to know
- Two ticks under **Settings → Users**: **Enter inventory counts** lets a person type counts; **Send counts to LS** lets a person send them. Admins can do both.
- Once sent, the checklist's numbers are read-only in VMS.
- Sending needs the Lightspeed connection to have full access. If LS refuses, reconnect under Settings → Lightspeed and approve full access.
