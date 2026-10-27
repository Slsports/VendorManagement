---
title: Check a vendor's invoices are in Bill.com (Emery Jensen)
section: Vendors
keywords: Bill.com, Emery Jensen, EJD, Stihl, Pacific Stihl, In Bill.com, paid offline, enter in Bill.com, EJD portal, not entered
who: Admin
---
For a vendor you pay on their own website and then mark paid offline in Bill.com (Emery Jensen), VMS checks that every invoice it files is in Bill.com.

## How to
1. Open the vendor and click **Edit**.
2. Tick **Check its invoices are in Bill.com**.
3. In **Paid on, when not paid in Bill.com**, type where you pay them (for Emery Jensen: the EJD portal). Click **Save**.

## What VMS does
- VMS reads each invoice and credit it files for the vendor: the invoice number, the PO, the total, and how it is billed at the top of the paper (**Stihl** or **EJD** for Emery Jensen). That shows as a tag on the paper.
- Each invoice is matched to its Bill.com bill by invoice number (or by PO and amount). It shows **In Bill.com**, then **Paid** once Bill.com shows it paid. Only people with the Accounting tick see these two tags.
- An invoice that is not in Bill.com 3 days after it came in gives you an Accounting task **Enter … invoice … in Bill.com**. **Go to it** opens the invoice. The task closes itself once the bill is in Bill.com.
- The pay-by task says **Pay … on the EJD portal, then mark it paid offline in Bill.com**. A Stihl bill's task lists the Stihl credits on file, and an EJD bill's task lists only EJD credits, so the two are never mixed.

## Good to know
- VMS reads Bill.com bills due in the last 120 days, so only invoices from that time are checked.
- Bill.com credits are not read yet; credits are filed in the vendor's **Credits** folder.
