---
title: The LS PO (drafted by Claude, approved, reviewed, entered in LS)
section: Ordering
keywords: LS PO, purchase order, Lightspeed, PO number, send to Lightspeed, approve, review, naming, category, new items, Trevor, confirmed
who: Admin, managers and buyers
---
When a vendor confirms an order, Claude drafts its LS PO. The person who placed the order approves it, then Trevor reviews it and enters it in LS.

## How it goes
1. **Claude drafts it** from the vendor's confirmation (or our order's items when there is no confirmation yet). Items already in LS keep their LS name and category; new items get a name and category following the LS category standard.
2. **The person who placed the order approves it.** They get a task "Approve the LS PO for …". Open it, check quantities and costs, change anything, and click **Approve**.
3. **Trevor reviews it.** He gets "Review the LS PO for …". He checks names, categories and new items, and clicks **Send to Lightspeed** (or **Send back** to the person who placed it).
4. **Send to Lightspeed** puts the items on our PO in LS (and makes the PO there first if nobody clicked **Create PO in LS** yet). Each item is found in LS by its System ID, Vendor ID or UPC.
5. **Items not in LS yet** are listed at the top. Add them in LS, then click **Send again**: only the missing ones are added. When every item is on, it shows **In LS** and the PO is on the order.

## Where to find it
- On the dashboard's **Ordering** card, click **LS PO** for every PO on its way and who it waits on. "2 with you" means two wait on you.
- On the order page, the **LS PO** box has **Open the LS PO**.

## Good to know
- Items show **In LS** (with the LS System ID) or **New to LS**. VMS knows what is in LS from the vendor's latest sales report; with no report, every item counts as new.
- **Redraft** has Claude draft it again from the latest confirmation (your changes are replaced).
- A confirmed order from before this started shows "confirmed, no LS PO yet" with **Draft it**.
- Items already sent show **On the PO in LS**, so nothing is ever added twice.
- To do it by hand instead: **Download for LS** or **Print**, enter it in LS, type the PO number and click **Done**.
