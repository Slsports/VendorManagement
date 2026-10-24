---
title: The LS PO (drafted by Claude, approved, reviewed, entered in LS)
section: Ordering
keywords: LS PO, purchase order, Lightspeed, PO number, send to Lightspeed, approve, review, naming, naming SOP, category, new items, rename, discontinued, do not reorder, Trevor, confirmed
who: Admin, managers and buyers
---
When a vendor confirms an order, Claude drafts its LS PO. The person who placed the order approves it, then Trevor reviews it and enters it in LS.

## How it goes
1. **Claude drafts it** from the vendor's confirmation (or our order's items when there is no confirmation yet). Items already in LS keep their LS name and category; new items get a name by Trevor's naming SOP and a category by the LS category standard. Anything Claude could not confirm is in [brackets], never guessed.
2. **The person who placed the order approves it.** They get a task "Approve the LS PO for …". Open it, check quantities and costs, change anything, and click **Approve**.
3. **Trevor reviews it.** He gets "Review the LS PO for …". He checks names, categories and new items, and clicks **Send to Lightspeed** (or **Send back** to the person who placed it).
4. **Send to Lightspeed** puts the items on our PO in LS (the PO is made in LS right then, once, with our PO in **Reference #**). Each item is found in LS by its System ID, Vendor ID or UPC.
5. **New items are entered in LS** with their name, category, vendor, Vendor ID, UPC, cost and the retail price from **Check-in pricing**. VMS holds one back while it still has a ⚑ flag that needs you: [brackets] in the name, "Needs manual description", "Waiting on Vendor ID", a name another item has, or a category LS doesn't have.
6. **Items not in LS yet** are listed with the reason. Fix the name or category here (or add the item in LS), then click **Send again**: only the missing ones are added. When every item is on, it shows **In LS** and the PO is on the order.

## What LS received
At the bottom of the LS PO, **What LS received** › **Check LS** reads LS's stock log for the items already in LS, from the order date to today. For each item it shows how many were ordered and how many were added in LS, and each change: the store, the date, how (checked in on a PO, or a quantity typed in by hand) and who did it. Sales are left out. It can take a minute.

## Where to find it
- On the dashboard's **Ordering** card, click **LS PO** for every PO on its way and who it waits on. "2 with you" means two wait on you.
- On the order page, the **LS PO** box has **Open the LS PO**.

## Naming checks on each line
- Under a new item's name: its length out of 52 and anything that breaks the naming SOP, as you type.
- **⚑** lines: what to check before sending, such as the Vendor ID on the invoice (the invoice always wins).
- **\* Discontinued** or **\*\* Do not reorder**: the item is marked that way in LS. Take it off the order (trash can) or keep it.
- **Rename in LS to the naming SOP**: an item already in LS whose name breaks the SOP. Leave it ticked (change the name if you like) and it is renamed when you send. A rename that changes what the name says goes on the **Print new shelf tags** task.

## Good to know
- Items show **In LS** (with the LS System ID) or **New to LS**. VMS knows what is in LS from its own copy of LS (updated every few hours) and the vendor's latest sales report.
- Under the vendor's name, **drafted from the vendor's confirmation** opens the confirmation Claude read.
- **Redraft** has Claude draft it again from the latest confirmation (your changes are replaced).
- A confirmed order from before this started shows "confirmed, no LS PO yet" with **Draft it**.
- Items already sent show **On the PO in LS**, so nothing is ever added twice.
- To do it by hand instead: **Download for LS** or **Print**, enter it in LS, type the PO number and click **Done**.
- Vendors with their own Vendor ID rule (Planet Cotton: garment # / design #): when LS has the garment only under its old Vendor ID (like 18500), the line asks you to pick that item or keep it as a new one. Existing LS items keep their Vendor IDs.
