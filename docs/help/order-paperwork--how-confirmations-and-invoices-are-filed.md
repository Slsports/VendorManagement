---
title: How confirmations and invoices get filed
section: Order paperwork
keywords: automatic filing, email attachment, confirmation, invoice, saved to, folder, year, orders@, matched to order
who: Everyone
---
Vendor confirmations and invoices that arrive by email are saved and matched to their order without anyone lifting a finger.

## What happens
1. A vendor emails a confirmation or invoice to orders@ (or to a personal VMS mailbox).
2. VMS saves the attachment to that vendor's **Confirmations** or **Invoices** folder, under the year. It goes by the file name, then the subject, then the words in the email ("sales order", "invoice"). If none of them say, Claude opens the PDF to see what it is. The email shows a green tag such as "Saved to Confirmations › 2026".
3. Claude reads it and finds the order: by our PO number, else the vendor's own order number on an earlier document, else the email conversation, else the order within about 3% of the total, else by comparing it with the vendor's open orders (never just because there is only one).
4. Claude compares it and puts the result in front of the person who placed the order.

## Good to know
- If Claude cannot tell which order it is for, it asks "Which order is this for?" (see "Pick the order for a confirmation or invoice").
- If a file is really an invoice and was filed as a confirmation (or the other way), Claude refiles it. If it is neither, it is marked "Not a confirmation or invoice", and a file saved from an email moves to **Other**.
- A file saved by hand works the same: **Save to documents** on an email, an upload on the vendor page, or **Attach** on the order.
- Moving a file into Confirmations or Invoices starts a check; moving it out sets its unfinished check aside.
- Old files, and papers dated more than six months back, are filed but not checked.
