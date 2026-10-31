---
title: "Unavailable items: replaced, discontinued or out of stock"
section: Review queue
keywords: unavailable, on backorder, backordered items, rep says, email the rep, discontinued, replaced, replacement, out of stock, backorder, back in stock, DNR, do not reorder, asterisk, Lightspeed note, confirmation, find replacement, don't need, sales report, no replacement on file
who: Admin, managers and buyers
---
When a vendor's confirmation says an item is discontinued, replaced or out of stock, Claude puts a card in the **Unavailable items** tab of the Review queue for whoever placed the order. On the vendor's page and on the confirmation check they all show in one card, **Items the vendor says are unavailable**, one row per item. What you choose is written to Lightspeed for you, so nobody has to go into Lightspeed separately.

Backordered items are different: the vendor is still sending them, just later. They make no card. They show on the order under **On backorder**, the order is marked Backorder, and nothing is written to Lightspeed.

## On the vendor's page (all items at once)
1. At the top of the vendor's page, find **Items the vendor says are unavailable**.
2. Each row shows the item, what the vendor wrote and what Claude read. When Claude is sure, its choice is already picked.
3. Pick **What to do** on each row. For **Use replacement** type the replacement's Vendor ID; for **Out of stock** add the back-in-stock date if the vendor gave one; for **DNR** type why.
4. Click **Save** once. Every row with a choice is saved and written to Lightspeed. Rows you skip stay for later.

## How to (one card at a time)
1. Open **Review queue** and click **Unavailable items**.
2. Read the card: the item, what the vendor wrote, and what Claude read. When Claude is sure, its choice is already picked. Click **the confirmation it came from** to see the vendor's confirmation, or **the order**.
3. Pick one:
   - **Use replacement**: check the replacement's Vendor ID.
   - **Discontinued, no replacement**
   - **Out of stock**: fill in or fix the back-in-stock date if the vendor gave one.
   - **DNR (do not reorder)**: for bad quality or poor sellers. Type why.
   - **Leave as is**: when Claude misread and nothing should change.
4. Click **Save and write to Lightspeed** (or **Leave as is**).

## Items the rep says are unavailable
When you **Email the rep** from a suggested order, Claude reads the rep's reply and puts a card here for each item the rep says is discontinued, replaced or out of stock. The card's title ends with "(the rep says)" and **the rep's reply** opens their email. Decide it the same way as above.

## Discontinued items a sales report found
A sales report also puts a card here for every item marked * discontinued in Lightspeed whose note names no replacement we can use (none noted, one that is not in Lightspeed, or a chain of replacements that dead-ends). The card goes to whoever ran the report; click **the sales report (…)** on the card to open the report that found it. The report's **NOTES** cell says "DISCONTINUED: no replacement on file — decide on the Review tab"; click it in the viewer and the card opens on top of the **Unavailable items** tab.
- **Find replacement**: click **Make the task**. A task "Find a replacement for …" goes on your task list, due in a week. Its **Open the item card** button brings you back here; type the replacement's Vendor ID and click **Use replacement**. VMS writes "REPLACED WITH …" to Lightspeed and finishes the task. **Don't need after all** is there too.
- **I know the replacement**: type the Vendor ID and save. Same as **Use replacement** above.
- **Don't need**: we stop ordering it. A dated "NO REPLACEMENT NEEDED" line goes on the item's note in Lightspeed; the * stays.
- The next report shows the decision in **NOTES** ("a replacement is being sourced", "not needed", or the replacement with its need carried over) instead of asking again. One card per item, never two.

## What goes into Lightspeed
- **Use replacement** and **Discontinued** put * at the start of the item's name. **DNR** puts **. **Out of stock** never changes the name.
- A dated line goes on top of the item's note, newest first, with the initials of whoever decided, for example "10/18/26 DP: REPLACED WITH 71240", "10/18/26 DP: OUT OF STOCK AT VENDOR, BACK 11/15/26" or "10/18/26 DP: DNR: POOR QUALITY". The note that was there stays underneath.
- These notes are internal: they don't print on customer receipts. If an item's note already prints on receipts, VMS leaves that note alone and keeps the line in VMS.

## Good to know
- Only Dana, Trevor and Jarrett can choose **DNR**. Anyone else can **Send a message about DNR to Dana, Trevor or Jarrett**: pick who, say why, and click **Send**. They get a task, and the card stays open until they decide.
- Writing to Lightspeed needs **Full** access. If it isn't set, the card says so: open **Settings** › **Lightspeed**, choose **Full**, and click **Connect again**. Then click **Try Lightspeed again** on the card.
- If the item isn't in Lightspeed under this vendor, the card says so and the decision is kept in VMS.
- Once you decide, the final order email says it plainly, like "… was discontinued, replaced with …" or "… is out of stock, back 11/15/26".
