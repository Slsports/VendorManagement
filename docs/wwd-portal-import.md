# Worldwide vendor portal → VMS

Dana (Oct 7): the WWD member portal (worldwidebuygroup.com, Vendors tab) holds, per vendor, Address Info,
Contacts & Sales Representatives, Programs, Product Lines and Resources. She wants all of it in VMS, then
a bulk email asking every vendor to confirm their details through the VMS contact form.

## Two scripts
1. `scripts/scrape-wwd-portal.mjs` — runs on Dana's computer (the cloud sessions cannot reach the portal).
   Playwright, headed browser. It opens the portal, waits for Dana to sign in, then for every vendor in the
   Vendors list (or every search letter A–Z, whichever the site exposes) opens the vendor, expands the five
   sections and appends one JSON object to `wwd-portal-vendors.json` (git-ignored). Resumable: skips
   vendors already in the file. Polite: one vendor at a time, a short pause between pages, stop on the
   first sign of a block. Dana's credentials are typed into the browser window, never into the script.
2. `scripts/import-wwd-portal.mjs` — runs anywhere with the hosted database. Matches each portal vendor to
   a VMS vendor with `scripts/lib/match.mjs` (exact → alias → generic-word → prefix; unmatched to a
   report, never auto-created unless Dana says so). Nothing overwrites a value Dana typed; portal values
   fill empty fields and go into `vendor_portal_data` whole.

## JSON per vendor (what the scraper writes)
```
{ "name": "Crosman Corp", "portal_id": "…", "scraped_at": "2026-10-08",
  "address": { "address1": "PO Box 74708", "address2": "", "address3": "", "city": "Cleveland", "state": "OH", "zip": "44194-4583", "phone": "800-724-7486", "fax": "" },
  "contacts": [ { "name": "Dan Gainor", "title": "Sales Manager", "company": "", "email": "dgainor@crosman.com", "phones": ["480-460-9134", "808-227-8887"], "territory": "National" } ],
  "programs": [ { "name": "Standard", "discount": "Buy Group Price", "billing_terms": "Net 30 Days", "freight_terms": "Collect\nPPD $4000", "minimum_order": "$500", "shipping_points": "Rogers, AR", "ship_dates": "" } ],
  "product_lines": [ { "category": "SHOOTING SPORTS", "line": "AIR GUNS & ACCESSORIES" } ],
  "resources": { "zero_upcharge": "N", "defective_goods_policy": "Call For RA", "defective_goods_comments": "", "ra_required": "Y", "returns_address": "Crosman Corp\n7629 Routes 5 & 20\nBloomfield, NY 14443", "who_pays_defective_freight": "", "defective_compensation": "Credit Memo" } }
```
Keep every field as the portal shows it (raw strings); the importer does the interpreting.

## Field mapping (importer)
| Portal | VMS | Rule |
|---|---|---|
| Address, city, state, zip, phone, fax | vendors.address/city/state/postal_code/phone/fax | fill if empty |
| Contacts | review_items kind `vendor_contact` (one per person, with email, phones, title, company, territory) | never written straight to `vendor_emails`; Dana approves. A contact whose company is not the vendor (Harry Spotts, Proactive Sales and Marketing) is a rep: propose a rep group link |
| Programs.minimum_order | vendors.minimum_order | fill if empty |
| Programs.freight_terms "Collect / PPD $4000" | free_shipping_policy `sometimes`, free_shipping_threshold 4000, freight_program = raw text | PPD $N = free freight prepaid at $N; "Collect" alone = never |
| Programs.billing_terms | payment terms name (match "Net 30 Days" → Net 30) | fill if empty |
| Programs.shipping_points, ship_dates, discount | vendor_portal_data only, shown on the vendor page | |
| Product lines | vendor_portal_data; later the LS category mapping | |
| Resources.zero_upcharge Y/N | vendors.wwd_zero_upcharge | set; log changes to the decisions log summary |
| Resources: defective goods policy, RA required, returns address, who pays freight, compensation | vendors.return_notes (one composed paragraph) + vendor_portal_data | fill if empty |

## Programs: standard and show (Dana, Oct 7)
Show vendors list a "Standard" program and one or more "SHOW - Fall Show" / "SHOW - Spring Show" programs
with a year, an **Expires** date, a show discount, show billing terms, show freight tiers and **Ship Dates**
(beginning and ending: the window the show order may be dated into). The scraper writes every program with
`name`, `year`, `expires`, `ship_begin`, `ship_end` as the portal shows them.

Freight terms are read into tiers: "PPD $5000" = free freight prepaid at $5,000; "50% FA $3000" = half
freight (50 percent freight allowance) at $3,000; "Collect" alone = we pay; "Excludes Specials" and any
other words stay as a note. Billing terms stay as text ("2% 30 Net 90 Days").

**History is kept.** Programs are never dropped. Each one carries a status computed from today:
- **Active** (green): today is within its dates, or it has no expiry (Standard).
- **Expiring soon** (amber): expiry within 30 days.
- **Expired** (gray, tag "expired 9/3/26"): shown below the live ones on the vendor page, so a show order
  that ships six months later can be checked against the terms it was placed under.
An order placed while a program is active keeps a link to that program (`orders.program_id`), and the
order page shows the program's terms even after it expires. Each year's show program stacks under the
last. Table: `vendor_programs` (organization_id, vendor_id, source 'wwd_portal'|'manual', name, kind
standard|show, year, expires_on, discount, billing_terms, freight_terms raw, freight_tiers jsonb,
minimum_order, shipping_points, ship_begin, ship_end, notes, scraped_at, unique per vendor+name+year).
The Standard program fills the vendor's everyday fields (section above); show programs feed the
show-prep view and the "Show special" reason on an order's free-shipping answer.

## New table
`vendor_portal_data` (organization_id, vendor_id, source 'wwd_portal', scraped_at, data jsonb, unique per
vendor+source) with RLS by `user_in_org`, editors write. The vendor page gets a "Worldwide portal" card
showing programs, product lines and returns policy with the scrape date.

## After the import
- Report: matched / unmatched / fields filled / contacts proposed / zero-upcharge changes.
- Bulk email (through the Gmail connection, from orders@, Dana's signature): "please confirm your contact
  and ordering details" with a link to the VMS vendor form; replies land in the review queue.
