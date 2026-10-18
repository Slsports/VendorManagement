# For Fable: Run report and Run order buttons (Dana, Oct 18)

Dana decided this today; it is yours to build because you built the sales reports and the **Reports** button. The
decision is in `docs/decisions.md` (Oct 18, "Ordering box and Ordering card"). Give Dana a short overview and wait for
her "go" as usual.

## What Dana wants
Now that VMS reads Lightspeed directly, ordering should not start with uploading a sales report.

1. **Run report**: one click runs that vendor's sales report from LS and files it under the vendor, exactly as a vendor
   run from the Sales Reports page does today (`runLsReport`, so it also feeds Suggested order).
   - Settings: **last 12 months, all stores together** (your `DEFAULT_PARAMS`: 365 days, `store_mode: 'together'`).
   - Anything else (other periods, stores apart, several vendors) stays on the Sales Reports page. Dana: "if we need to
     change it we go to the reports page and customize the report."
   - The vendor's LS vendor(s): the vendor's `lightspeed_vendor_id` (and any other LS vendors the Sales Reports page
     already ties to it). If the vendor is not tied to LS, say so on the button's message and point to **In Lightspeed
     as** on the vendor page.
2. **Run order**: runs the report (unless one was already run today for that vendor) and then opens **Suggested order**
   from it, so the buyer goes straight to quantities.
3. **Where**:
   - The **Ordering** box on the vendor page (`src/components/ordering/VendorOrderingPanel.tsx`), next to **Check if we
     need it** and **Remind me to order**.
   - Each vendor on the dashboard **Ordering** card (`src/components/ordering/OrderingCard.tsx`): the flag takes the
     buyer straight to the work (CLAUDE.md "No extra clicking").
4. **Keep Upload sales report**: Dana: "do not remove, we may have some historical reports we want to upload." It can
   become a smaller link next to the new buttons.
5. **Reports** (opens the Sales Reports page with the vendor picked) stays for custom runs.

## Notes
- Show progress while the report runs, and the plain error if LS or the vendor tie is missing.
- Help articles in the same commit (the ordering and sales report articles), decisions appended when built.
- The Opus session did not touch these files. Its new work you may want to read: unavailable items on vendor
  confirmations (`item_changes`, migration 170, the **Unavailable items** Review tab). Your sales reports can show those
  items too (discontinued / replaced / out of stock with the back date, DNR) alongside the LS notes and markers.
