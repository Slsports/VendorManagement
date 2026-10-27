---
title: Connect Dropbox and file what is in it
section: Settings
keywords: Dropbox, connect, app key, folder, dry run, list the folder, read the files, approve, file, leftovers, scan inbox, ScanSnap, historical documents
who: Admin only
---
VMS can read one folder of your Dropbox and file what is in it by VMS's own rules: a paper about a vendor goes under that vendor's Documents, a paper for the books goes to Accounting Documents, and anything that is not a document is skipped. The Dropbox folder names do not decide where things go; the paper itself does. Nothing is filed until you approve it, and your Dropbox is not changed.

## How to connect
1. Go to **dropbox.com/developers/apps**, signed in as yourself, and click **Create app**. Choose **Scoped access**, then **Full Dropbox**, and name it VMS.
2. On the app's **Permissions** tab tick **account_info.read**, **files.metadata.read**, **files.content.read** and **files.content.write**, then click **Submit**.
3. On the **Settings** tab, under **OAuth 2 › Redirect URIs**, paste the address shown on VMS's Dropbox page and click **Add**.
4. Copy the **App key** (not the secret), open **Settings** › **Dropbox** in VMS, paste it and click **Save**.
5. Click **Connect to Dropbox**, allow VMS on Dropbox's page, and you come back **Connected**.

## The history pass
1. Under **The folder VMS reads**, browse to your folder (for example Shaver Lake Sports), click **Pick**, leave **History** chosen and click **Save folder**.
2. Click **List the folder**. VMS lists every file in it and its subfolders; a big folder carries on in the background.
3. Skip the folders that are not for VMS, then click **Read the files (Claude)**. Claude looks at each file and proposes where it goes. This runs about twenty files a minute in the background; the table updates by itself.
4. The table shows each folder under the one you picked: how many files, how many are **Proposed** (and how many of those Claude is **sure** about), and how many are **For you** to place. Folders that are not for VMS (staff files, payroll, websites): click **Skip folder** and nothing in them is read. **Read this folder** puts one back.
5. Click a folder to see its files, with the subfolder each sits in. **Open** next to a file name shows the file itself right in VMS, so you can look before you decide. Each one says where it would go, for example "Zebco › Invoices › 2025 · 1600009625 · $412.00" or "Accounting › insurance › Cal Fair › 2026". **Approve** it, **Skip** it, or click **Vendor…** to pick the vendor and folder yourself.
6. **Approve sure** on a row approves everything Claude is sure about in that folder; **Approve all sure ones** does it for every folder.
7. Approved files are filed within a couple of minutes, or at once with **File the approved now**. They then show in the vendor's Documents or in Accounting, with **From Dropbox** and the path they came from.

## Good to know
- A file already in VMS (the same bytes, or the same name and size under the vendor) is marked **Already in VMS** and never saved twice.
- **For you** means Claude could not place it with confidence, most often because the vendor is not in VMS under that name. Click **Vendor…** to say who it is.
- A paper about a **line** (a catalog name on the Lines page that is not a vendor yet, like a rep's show order form) goes under that line, and the proposal says so.
- A **freight** carrier's bill fills the bill in VMS that is waiting for its PDF (same invoice number) and is read right away. One with no bill waiting stays **For you**.
- Worldwide's own paperwork (payment sheets, exports) is never filed under a vendor; it stays **For you**, since the Payments page handles it.
- **Skipped** files are pictures with no paper, templates, shortcuts and the like, plus old Word **.doc** files, which Claude cannot read (save one as .docx or PDF to have it read). Newer **.docx** files are read as their words. **Everything** in a folder's list shows the skipped ones.
- **List again** picks up files added to the folder since the last listing.

## The scan inbox (after the history is done)
Change the folder to the one your scanner saves to, choose **Scan inbox: file new files on their own**, and tick **Move filed files into a Filed subfolder** if you want to see what is done. New scans are filed within a couple of minutes when Claude is sure; the rest become a task for you, **Where does this scan go**, that opens this page.
