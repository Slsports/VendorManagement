---
title: Paid invoices
section: Documents
keywords: paid, invoice, payment, which invoices, mark paid, none of these, bill pay, portal, Rossignol, receipt, remittance, status, paid tag
who: Admin (people with the Accounting tick)
---
An invoice VMS knows is paid shows a green **Paid** tag in the vendor's Invoices folder, with the date and how it was paid (like "Rossignol bill pay"). **payment email** next to it opens the email it came from.

## How it works
1. When someone forwards a payment to orders@ (for example Tyler forwarding Rossignol's bill-pay receipt with the invoices attached), or a vendor sends a payment receipt, Claude reads it.
2. The invoices it names, or the invoices attached to it, get the **Paid** tag.
3. If an invoice it names isn't on file yet, it gets the tag as soon as it's filed.
4. If the email doesn't name any invoice numbers (like "I paid them over the phone"), the unpaid invoices that came earlier in the same email conversation get the tag.
5. If none came in that conversation, you get a task: **Which … invoices did the … payment pay?** In the task, tick the invoices it paid and press **Mark paid**, or press **None of these**. Click an invoice to open it first. The task also closes by itself once none of those invoices is unpaid any more.

## Good to know
- Invoices, payment reminders and past-due notices are not payments; they don't mark anything paid.
- Private mailboxes and the Accounting mailbox are never read for this.
- WWD invoices and Bill.com keep their own paid status on the Payments page. For every vendor you pay through Bill.com (VMS turns the check on by itself the first time a Bill.com payment to that vendor comes in), the invoice gets **Paid** once Bill.com shows it paid, however old it is.
- Only people with the Accounting tick see the **Paid** tag.
