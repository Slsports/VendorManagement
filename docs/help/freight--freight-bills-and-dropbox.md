---
title: Freight bills and your Dropbox (both ways)
section: Freight
keywords: Dropbox, freight bill, PartnerShip, UPS, FedEx, XPO, Priority 1, download, upload, copy, Freight folder
who: Admin, managers and buyers
---
Freight bill PDFs stay the same in VMS and in Dropbox, whichever one you put them in first.

## How it works
1. **Saved to Dropbox first:** put the bill PDF in the Dropbox folder **1-A Shaver Lake Sports › Freight** (any carrier folder inside it, like Freight/PartnerShip or Freight/UPS/2026). Within a few minutes VMS finds it, reads it and files it on the **Freight** page, on the bill that was waiting for it or as a new bill. If VMS is not sure which carrier it is, it asks you in Settings › Dropbox.
2. **Uploaded to VMS first** (by you or Trevor): VMS copies the PDF to Dropbox in the carrier's folder under Freight, named with the invoice date first, like "10-12-26 PS00626515 PartnerShip Invoice.pdf", so you can find a bill by date. UPS bills go in the year folder (Freight/UPS/2026).
3. Either way, the bill is then read and matched to its orders as usual.

## Good to know
- A PDF already in Dropbox (the same file, whatever its name or folder) is never copied again, and a file VMS copied to Dropbox is never read in a second time.
- One bill per invoice: when the same invoice from the same billing company comes in again (the carrier's email, Dropbox, an upload), VMS keeps the bill it already has and adds the email or PDF to it. It never makes a second bill. If the newer one is a corrected bill (same invoice number, different total), the newer one wins: the bill takes the new PDF, total and shipments, keeps its payment, and its note says what was replaced.
- The carrier folders are PartnerShip, UPS (by year), FedEx, XPO, Pinnacle-Priority 1 and SHIP STATION - WWEX GROUP. A new freight company gets a folder with its name.
- Copying into Dropbox needs the **files.content.write** permission on your Dropbox app. If Settings › Dropbox says VMS cannot save freight bills yet, tick it on the app's **Permissions** tab in the Dropbox App Console, click **Submit**, then click **Reconnect** in Settings › Dropbox.
- Only the Freight folder is watched. The rest of your Dropbox was read once when Dropbox was connected.
