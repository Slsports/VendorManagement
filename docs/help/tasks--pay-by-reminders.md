---
title: Pay-by reminders (early-pay discounts and freight back)
section: Tasks
keywords: I paid it, Edenred, Bill.com, pay it, pay early, discount, early pay discount, terms, 2% 30, net 90, freight back, freight allowance, pay by, due date, payment reminder
who: Admin only
---
VMS turns every bill worth paying by a date into a task for Dana, reminded 5 days before the date.

## What makes a task
- **Early-pay discounts** on WWD invoices, from their terms (for example "2% 30, NET 90" or "6%30, 4%60, 3%90, NET91"): "Pay Panther Martin by Oct 14 for 4% off ($74.14)".
- **Discount terms in an order's AR due** notes, when the order has no WWD invoice: pay by its AR due date.
- **Freight back** for paying on time, from the order's **Freight allowance** box: "Pay Water Sports by Oct 30 to get the freight back ($542.28)".
- **Bills in Bill.com** due within 7 days: "Pay Paricon $412.00 by Oct 26 (Bill.com)". The task closes itself once Bill.com shows the bill paid or scheduled.

## How it works
1. The task appears in **My tasks** with the pay-by date as its due date.
2. Five days before, the reminder comes the way you chose (dashboard, email, text).
3. Click the task. Its box shows the bill: vendor, invoice, amount, terms and due date, with **Pay in Edenred** (WWD bills) or **Pay in Bill.com**, which opens the pay page in a new tab. VMS never pays anything itself.
4. After you pay, click **I paid it**. The bill is marked paid and the task is done. The payment import adds the payment number later.
5. The first time, paste your Edenred pay page address into the box and click **Save**; after that it's a button.
6. A bill that shows as paid in VMS (from a payment import) checks its task off on its own ("Paid").
7. If a discount date passes unpaid, that task closes and the next one takes over: the next discount tier, then the net due date ("payment due").

## Good to know
- Checking a pay-by task off yourself means "handled": no more reminders for that bill.
- VMS looks for new ones every hour, so bills from a WWD import show up within the hour.
