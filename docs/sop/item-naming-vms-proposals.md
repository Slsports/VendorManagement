<!-- Trevor's three VMS proposals for Lightspeed item naming, from the body of the email that carried SOP-INV-001-NC
(Dana forwarded it Oct 18, 2026). Copied as sent. Not approved yet: see docs/decisions.md and
docs/sop/item-naming-notes-for-fable.md. -->

# VMS PROPOSALS – LIGHTSPEED ITEM NAMING

Submitted by Trevor. Please see the attached SOP-INV-001-NC (Item Naming Conventions), which all three proposals follow, and the one-page Shorthand Cheat Sheet.

Note: These three proposals work together and need to be approved together. Proposal 1 (item name suggestions) relies on Proposal 2 (vendor record additions) for which vendors get a vendor ID in the name and how Lightspeed vendor names are matched, and on Proposal 3 (Lightspeed integration) for item categories, the duplicate-name check, the starting Item Name Memory, and entering approved names into Lightspeed. Approving only one or two of them would leave those parts unable to work.

## PROPOSAL 1 OF 3

Section: Section 13 – Order Document Library

Proposed addition:

Lightspeed Item Name Suggestions. Claude drafts a Lightspeed item name for every line of an order, following SOP-INV-001-NC (Item Naming Conventions). Naming can begin as soon as the order reaches "Order Received" (Section 12), using the product tags and the order confirmation, even if the order is still flagged "Awaiting Invoice." The vendor ID is added, and the final SOP check is completed, once the invoice arrives and the Check-in Document is generated (items checked against the invoice, as today). Suggested names are never saved automatically; staff approve or edit each one, and choose the Lightspeed category for any new item (Claude suggests one from similar items), since the category decides Fishing rules.

Claude builds each name from these sources, in this order:

1. Item Name Memory: if this item has been named before (matched by the same vendor plus vendor ID, or by UPC when the vendor ID isn't available yet and that UPC belongs to only one item), the approved name is reused. The vendor ID in a reused name is always checked against the current invoice and replaced if it differs; that counts as a change to what the name says, so it creates a shelf-tag task (Proposal 3). Names that came over from Lightspeed are reused only if they already pass the SOP check; otherwise Claude suggests a corrected name (see Rename on Reorder, Proposal 3).
2. A photo of the product tag, taken once the order is received. Claude reads the brand, product details, color, and size from the tag. The brand always comes from the tag, never the invoice, and is written exactly as it appears there, punctuation included (accented letters are replaced with plain letters). If the tag shows both a parent company and a product brand, the product brand is used (for example, SCHOOL O' MINNOWS rather than LUHR JENSEN). Whenever the tag and the paperwork disagree, the tag wins — except for the vendor ID, which always comes from the invoice.
3. The order confirmation, the invoice text, and any product images on them.
4. A vendor line sheet or catalog, if one is on file in the vendor record.
5. A web search by vendor item number, style number, or UPC, used only as a last resort and mainly for brand-name vendors with public catalogs. Skipped for custom and Shaver Lake printed merchandise.

Rules:

- The vendor ID always comes from the physical invoice and is copied exactly as printed. For WWD orders that have both the vendor's own invoice and an EdenRed invoice (Section 14), the vendor's invoice is used; if the two show different vendor IDs, the line is flagged on the dashboard for staff to check before the name is approved (this ties into the Section 16 open item on EdenRed cross-checks).
- When a vendor name is used in place of a brand, it never includes the buying source (LAZY ONE, not LAZY ONE (WWD)).
- Fishing color shorthand (the approved list in the SOP, such as CHART, FLO, GLO, HOLO) is used only on Fishing category items, and only when spelling the color out would put the name over 52 characters; otherwise colors are spelled out in full.
- Any part of a name Claude could not confirm is shown in brackets and flagged, never guessed. Anything taken from the web shows its source link.
- If no source gives enough detail, the line is flagged "Needs manual description."

SOP check: before staff approve a name, Claude checks it against every line of the SOP's "Before You Save the Name" checklist and flags any problem, including: parts out of order (marker, brand, sizing, description, color, size, Ty birthday, vendor ID); a space after a * or ** marker; a measurement placed in the size slot instead of the description; over 52 characters (do-not-reorder asterisks count); a name that already exists on another Lightspeed item (no duplicate names); lowercase letters in the name, Brand field, Custom SKU, or Tags; a Brand field that doesn't match the brand on the tag; double spaces; accented letters anywhere; apostrophes, commas, pound signs, periods other than decimals, ™ or ® symbols, curly quotes, or any other mark the SOP doesn't allow, outside the brand and vendor ID (™ and ® are removed from the brand too); no space between a number and its unit, including SPF (SPF 15); LB and LBS not matching the weight (LB for 1 pound or less, LBS for more) or LBS used for fishing line strength; a space next to a dash, around a slash (BLUE / WHITE, 14 / 16), before a foot or inch mark, or around the X in a dimension (7X13); no space after W/ or W/O (W/HOOD) — W/ and W/O are the one slash that always takes a space after it; a space between a letter size and its parentheses (LG (14/16) instead of LG(14/16)); sizing words not using their shorthand (WOMENS, YOUTH, or JUNIOR instead of WMNS, YTH, or JR); KID instead of KIDS; YTH combined with GIRLS or BOYS instead of GIRLS or BOYS up front and YTH next to the size (PULSE GIRLS JACKET ... YTH LG); SHAVER LAKE instead of SL; WITH or WITHOUT instead of W/ or W/O; L/S or S/S instead of LS or SS; LTR instead of L; NYL instead of NYLON; BABY used as a sizing category; GREY instead of GRAY; OS instead of ONE SIZE; sizes spelled out (SMALL, LARGE), written as single letters in the size slot (S, M, L — L elsewhere is the approved shorthand for liter), or oversizes not written as listed (XXL instead of 2XL); the word SIZE on clothing (ONE SIZE is allowed); pack counts, pairs, infant sizes, or toddler sizes not in the SOP format (3 PK, 6 PR, 6 MO, 0-3 MO, 2T); four or more colors joined with slashes instead of MULTI; a numbered footwear size without SZ, or SZ used on letter-sized footwear or on clothing; ASST written twice; fishing color shorthand used on a non-Fishing item, or when the full color would still fit within 52 characters; an asterisk anywhere other than the start of the name (VMS recognizes the * and ** do-not-reorder markers but never adds, removes, or changes them); shorthand not on the Approved Shorthand List; optional shorthand (anything beyond sizing words, sizes, measurement units, pack and count words such as PK and PR, ASST and MULTI as colors, SL, W/, and W/O) used when the full words would still fit within 52 characters; a Ty birthday not written as a 3-letter month and day (MAR 6) or not placed right before the vendor ID; a missing or misplaced vendor ID on Fishing, Coghlans, World Famous Sports, Lazy One, or Ty items (unless the invoice has no vendor ID for that item); and a vendor ID on an item from any other vendor. The brand and vendor ID are exempt from the punctuation checks; the brand is checked against the tag photo and the vendor ID against the invoice. Invoice lines that share one vendor UPC but are different items are flagged to be split into separate entries. If a name is still over 52 characters after every shortening step in the SOP, staff can approve it as an accepted exception; VMS records it as an exception rather than an error.

Entering into Lightspeed: once staff approve a name, VMS enters the item directly into Lightspeed through the Lightspeed integration (Proposal 3). Items that need a vendor ID in the name (Fishing, Coghlans, World Famous Sports, Lazy One, Ty) are entered only after the vendor ID is added from the invoice, so their names never need a second change. Reordered items that already exist in Lightspeed are received into their existing item. When every retail line on the order has been entered or received, the order moves to "Entered into LS" automatically (Section 12). Lines the SOP doesn't cover (rentals, labor, marina fees, deposits, and non-retail purchases) are skipped for this purpose.

Dashboard: following the Section 2 rule that every flag surfaces on the dashboard, these appear on the Dashboard / Command Center and the To Do list: lines "Waiting on Vendor ID" (shown under the order's existing "Awaiting Invoice" flag, not as a separate flag), "Needs manual description," duplicate names, and accepted exceptions.

Item Name Memory: once a name is approved, VMS stores it with that vendor, vendor ID, and UPC, so future orders of the same item reuse it automatically.

Approved Shorthand List: kept in VMS settings and used for the SOP check.

## PROPOSAL 2 OF 3

Section: Section 3 – Vendor Record

Proposed addition:

Add to Basic Information:

- Lightspeed Vendor Name(s): an alias type alongside Shipping Alias(es) and Invoice Alias(es), recording how the vendor is named in Lightspeed (for example LAZY ONE (WWD), COGHLAN - WWD, WORLD FAMOUS SPORTS - WWD, TY INC - WWD). It works through the Vendor Alias / DBA System (Section 8), so Lightspeed items match the correct vendor record, and a Lightspeed vendor name VMS doesn't recognize is flagged on the dashboard like an unknown shipper.
- Item Name Vendor Name: the vendor's name as it should appear in Lightspeed item names (in ALL CAPS, no apostrophes, and never with the buying source attached, such as WWD), used only when an item has no brand on its tag.
- Add Vendor ID to Lightspeed Item Name (checkbox): when checked, item name suggestions for that vendor end with the vendor ID, copied exactly as printed on the invoice, per SOP-INV-001-NC. The checkbox goes on the record of the vendor the item is bought from (for example Lazy One), not on WWD or on a brand, so it applies whether or not the order came through WWD and covers that vendor's house brands (for example PULSE from World Famous Sports). It starts checked for Coghlans, World Famous Sports, Lazy One, and Ty, matching the SOP's list, and Fishing category items always include the vendor ID. If a vendor is added to the SOP's list later, checking its box is all VMS needs.

## PROPOSAL 3 OF 3

Section: New section – Lightspeed Integration (resolves the Section 16 open item "Lightspeed integration could eventually automate the 'Entered into LS' status")

Proposed addition:

Lightspeed Connection. VMS connects directly to Lightspeed through its API. It reads the item list (System ID, item name, vendor, vendor ID, UPC, brand, category, price, and which stores carry the item, with quantity on hand at each) so Item Name Memory starts with every item already in Lightspeed and every new name is checked against current Lightspeed items to prevent duplicates. It also enters staff-approved new items into Lightspeed, receives quantities into existing items for reorders, and sets the "Entered into LS" status automatically (Proposal 1, Section 12). Lightspeed vendor names are matched to VMS vendor records through the Lightspeed Vendor Name alias (Proposal 2).

Do-Not-Reorder Markers. VMS recognizes the two markers staff place at the start of a Lightspeed item name:

- \* (one asterisk): discontinued or can no longer be ordered from the vendor.
- \*\* (two asterisks): not to be reordered because it does not sell well or the quality is poor.

VMS shows the marker and its meaning wherever the item appears (vendor record, Order Management, and check-in). VMS warns staff when a marked item is on an order: while the order is in "Working on Order," before it moves to "Order Sent," and again at "Order Confirmed," when Claude compares the confirmation to the original order (Section 12), since many orders are placed outside VMS. Staff decide whether to remove the item or keep it. VMS never adds, removes, or changes a marker; only staff do that.

Rename on Reorder. When an existing item that does not meet SOP-INV-001-NC is reordered, its corrected name is suggested along with the other names on that order (Proposal 1). Any existing * or ** marker is kept exactly as it is. If staff approve a new name that changes what the name says (for example, a different product word, color, size, or vendor ID), VMS creates a task (Section 7 – Task Assignments) to print the new shelf tag, replace the old one, and verify it at the register, with one task for each store where the item is set up in Lightspeed, whether or not it is currently in stock (Shaver Lake Marina and The Happy Camper). Each task is assigned to the staff member who approved the name, is due within 7 days (matching the SOP), and follows the normal Section 7 rules (overdue tasks escalate to Dana and appear in the All Tasks feed). Shelf-tag tasks are created by VMS, so they show "Assigned by: VMS"; overdue notices go to Dana and the assignee. Cosmetic and shorthand-only changes (capitalization, spacing, curly quotes, removing marks the SOP doesn't allow, replacing accented letters, adding or removing a * or ** marker, or switching a word to its approved shorthand, such as YOUTH to YTH, SHAVER LAKE to SL, L/S to LS, or GREY to GRAY) do not create a shelf-tag task on their own.

Price Changes. Because the price is printed on the shelf tag, any price change on an item, seen through the Lightspeed integration, creates a same-day shelf-tag task for each store where the item is set up, whether or not the name changed. If the same item also has a rename task open, that item moves into the same-day price task (and comes off the 7-day task, including a grouped Batch Cleanup task). Who price-change tasks are assigned to is left for Dana to decide (for example, a default person for each store, set in VMS settings); they follow the normal Section 7 rules.

Batch Cleanup. Corrections can also be applied to all existing items at once. VMS shows staff the full list of proposed changes, and only the changes staff approve are sent to Lightspeed. Cosmetic and shorthand-only corrections need no new shelf tags. Corrections that change what the name says create shelf-tag tasks for each store where the item is set up, due within 7 days, grouped into one task per store listing all the affected items rather than one task per item. Because there is no tag photo for a batch, the batch never changes a brand except to fix capitalization, remove ™ or ® symbols, or replace accented letters; any other brand question is flagged and settled the next time the item is checked in. Markers are never changed. Existing duplicate names are listed on the dashboard for staff to resolve.
