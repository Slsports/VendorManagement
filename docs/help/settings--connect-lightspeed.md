---
title: Connect VMS to Lightspeed
section: Settings
keywords: Lightspeed, LS, connect, API key, client ID, client secret, sign in, authorize, integration
who: Admin only
---
VMS reads items, Vendor IDs, stock and sales from Lightspeed once it is connected. Nothing in Lightspeed changes until a batch is approved in VMS.

## How to
1. Register an API client at **cloud.lightspeedapp.com/oauth/register.php**. Use the redirect address shown on **Settings → Lightspeed**.
2. When Lightspeed shows the **Client ID** and **Client Secret**, copy them right away. The secret is shown only once.
3. In VMS, open **Settings**, then **Lightspeed**. Paste both and click **Save**.
4. Choose the **Access** (**Full** lets VMS write markers, notes and POs to Lightspeed; **Read only** does not) and click **Connect to Lightspeed**.
5. Sign in to Lightspeed and click **Authorize**. You come back to VMS, and the page shows **Connected** with your account and how many items are in Lightspeed.

## Good to know
- VMS keeps the Client Secret hidden. Nobody can see it again in VMS; **Replace them** saves a new pair.
- **Check the connection** reads the account again. **Disconnect** forgets the sign-in but keeps the key.
- The top of the page says whether the connection is **read only** or **full access**. The Access box starts on the current level; to change it, pick the other one and click **Connect again**.
- Never paste the secret into an email or a chat.
- **Items per vendor** shows the last reading of every Lightspeed item. **Read LS items now** reads them again (a few minutes); it also runs every week by itself. The Vendors list uses it for **LS items**.
