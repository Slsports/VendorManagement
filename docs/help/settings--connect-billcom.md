---
title: Connect Bill.com
section: Settings
keywords: Bill.com, developer key, sync token, organization ID, connect, bills due, forward invoices, inbox
who: Admin only
---
VMS connects to Bill.com lightly: it reads the unpaid bills every 15 minutes (for pay-by reminders 7 days ahead) and forwards the invoices of vendors you switch on to Bill.com's inbox. VMS never enters a bill or pays anything.

## How to
1. In Bill.com, open **Settings** › **Sync & Integrations** › **Manage Developer Keys** and make a new key named VMS (not the QuickBooks one). Copy the key.
2. On the same page open **Tokens** and make a new sync token for VMS. Copy its name and its value.
3. Find the organization ID (it starts with 008) under **Settings** › **Organization**.
4. In VMS open **Settings** › **Bill.com**, paste the **Developer key**, **Organization ID**, **Token name** and **Token**, and click **Save and connect**. VMS signs in once to prove them and shows **Connected**.
5. Click **Read the bills now** the first time. From then on it reads every 15 minutes.

## Good to know
- The key and token are hidden after saving; **Replace them** lets you paste new ones.
- **Bill.com inbox address** is where invoices are sent (shaverlakesports1@bill.com). Each vendor's switch is on its page under **Edit**: **Send invoices to Bill.com**.
- The page lists what was sent to the inbox lately. A failed one has **Send again**.
- **Disconnect** forgets the token; the key stays.
