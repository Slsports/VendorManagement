---
title: What happens when a file lands
section: Documents
keywords: lands, credit received, Received tag, filed, next step, automatic, refresh, live, confirmation check, proof task, credit task, packing slip, shipped, LS PO, tied to the order
who: Everyone
---
Every Documents folder refreshes itself the moment a file lands in it, whoever filed it: Claude from the mailbox, someone uploading on another screen, or a report run. No reload needed. And for some folders, landing starts the next step by itself.

## What follows a landing
- **Confirmations** and **Invoices**: Claude starts comparing it with the order the second it lands. The check shows on the **Review** card (Confirmations / Invoices) and in the order's **Paperwork** box. An invoice from an email for a vendor with **Send invoices to Bill.com** switched on is also forwarded to Bill.com's inbox, once, with its attachments.
- **Proofs**: a task **Approve the proof from [vendor]** goes to whoever placed the order (else the vendor's buyer, else Dana), due in 3 days. Clicking the task opens the proof itself, and the task shows the email it came in on. Click **Mark approved** on the proof and the task finishes itself.
- **Credits**: filed in the vendor's **Credits** folder and marked **Received** with the date it came in. If it answers a credit someone asked the vendor for, that request shows Received and its reminders stop; when Trevor's Edenred upload shows the credit, the paper gets **On Edenred** with the date and the request's task finishes itself. A credit nobody asked for gets no task. See "Credits you ask vendors for" under Tasks.
- **Shipping** (a packing slip): VMS ties it to the order by PO number (or the vendor's one open order) and moves that order to **Shipped**.
- **LS POs**: tied to its order by our PO number or the LS PO number (or the vendor's one open order), so the order page shows the LS PO on file.
- **Sales reports**: the suggested order is ready, and the vendor's waiting confirmations are checked again against it.
- **Price lists**, **Catalogs**, **Order forms**, **Show specials**, **Images**, **Damaged Items**, **Other**: just filed.

## Good to know
- The order page, Accounting › Documents and the Review tabs refresh live the same way.
- Removing a proof from its folder removes its task; moving a file to another folder does the same.
- Only proofs that came in within the last 30 days get a task. Older ones filed from past mail are kept in their folder as history, with no task.
