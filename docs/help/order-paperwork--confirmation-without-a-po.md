---
title: The PO on a confirmation (missing, not ours, or off our naming)
section: Order paperwork
keywords: no PO, missing PO, wrong PO, random PO, PO naming, naming convention, create PO, PO number, confirmation, task, update order, email vendor, need to use our PO
who: Admin, managers and buyers
---
Every confirmation review shows the vendor's PO at the top, checked against ours. Our PO is letters for the vendor plus the order date, like YAKIMA080626. Short codes and dates without leading zeros count too (LUXPRO9226, Panthermrtn9126).

## What the line says
- **PO matches ours** (green): nothing to do. Capital letters, spaces, dashes and extra words like "EARLY BUY" don't matter.
- **Their PO fits our naming** (green): the order has no PO yet, but theirs looks like ours. Type it on the order if it's ours.
- **No PO on their confirmation** (yellow).
- **Their PO "…" isn't ours. Ours is …** (yellow): the vendor put their own number or a different PO.
- **Their PO "…" doesn't fit our naming** (yellow): the order has no PO yet and theirs is a random number, like 26569.

## What happens with a yellow one
1. If the order has no PO yet, whoever placed the order gets a task: **Create PO: [vendor], [their order number]**, due the next business day.
2. Open the order and click **Create PO in LS**: VMS makes our PO and creates it in Lightspeed. If the check says **No order found**, pick or add the order first. Typing a PO on the order by hand works too.
3. As soon as our PO is on the order, the email asking the vendor to use it is written for you, and the task is done.
4. On the review, click **Open the email asking them to use our PO**. It opens right there: check it and click **Send**. (It's also in **Mail › Drafts**.)

## Good to know
- If the order already has our PO, the email is written right away; there's no task.
- Claude's comparison doesn't list the PO as an issue, so the vendor doesn't get asked twice.
- Web-order vendors (like Kelli's) are skipped.
- Papers more than 30 days old get no task and no email.
- Vendors **On hold** or **Do not order** get no task and no email: the check goes to Dana to look at.
