---
title: The PO on a confirmation (missing or not ours)
section: Order paperwork
keywords: no PO, missing PO, wrong PO, random PO, PO naming, naming convention, PO number, confirmation, update order, email vendor, need to use our PO, add our PO, written differently
who: Admin, managers and buyers
---
Every confirmation review shows the vendor's PO at the top, checked against the PO on our order. Every order has our PO from the day it's in VMS (see "Our PO number on every order").

## What the line says
- **PO matches ours** (green): nothing to do. Capital letters, spaces, dashes, extra words like "EARLY BUY", dates without leading zeros (OKUMA9126 for OKUMA090126) and a shorter vendor name (PLANET101926 for PLANETCOTTON101926) all count as ours.
- **No PO on their confirmation** (yellow).
- **Their PO "…" isn't ours. Ours is …** (yellow): the vendor put their own number or a different PO.
- If the check says **No order found**, pick the order first; then the line checks against its PO.

## What happens with a yellow one
1. VMS writes the email for you, kept in **Mail › Drafts**. Nothing is sent on its own.
   - No PO: it asks them to add our PO to their order.
   - A different PO: it asks them, nicely, to change the order to our PO and send an updated confirmation.
2. On the review, click **Open the email asking them to add our PO** (or **…to use our PO**). It opens right there: check it and click **Send**.
3. After it's sent, the line shows when you asked and what they answered (see "When a vendor didn't use our PO").

## Good to know
- Claude's comparison doesn't list the PO as an issue, so the vendor doesn't get asked twice.
- Web-order vendors (like Kelli's) and retail stores are skipped.
- Papers more than 30 days old get no email.
- Vendors **On hold** or **Do not order** get no email: the check goes to Dana to look at.
- There are no **Create PO** tasks any more.
