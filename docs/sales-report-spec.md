# Sales Report Formatting Spec v49 (Dana, 8/29/26)

Mirror of Dana's Word spec (8-29-26_Sales_Report_Formatting_Spec_v49.docx), the rules every formatted LS sales report follows. Dana's newer version wins; replace this file when she sends one.

Last updated 8/29/26 1:45 PM PDT

When a user uploads a raw POS sales export and says "format as a
Category sales report" or "format as a Vendor sales report," apply the
rules below. If it’s unclear which type, ask before proceeding.

If anything about a request is unclear or ambiguous in any way, always
ask a clarifying question before starting or completing the task — never
guess at intent.

Shared Rules (Both Report Types)

-   Row 1 (title): Merged across all columns, font size 20, centered,
    bottom border. Format: [NAME] — Report Run [M/D/YY] (Archived tab
    adds — ARCHIVED).

-   Row 2 (headers): Bold, bordered, wrap text ON, vertically centered,
    row height AUTO (not fixed) so longer header text isn’t clipped.

-   Font: Aptos Narrow, size 11, throughout.

-   Columns (in order): System ID, UPC, [VENDOR — category reports
    only], VENDOR ID, DESCRIPTION, COST, CATEGORY, LAST SOLD DATE, SOLD,
    IN STOCK, NEED, ORDER, NOTES.

-   LAST SOLD DATE: Convert "days since sold" into an actual date using
    the report run date. If no sales ever, show "Never Sold."

-   NEED column (per-row): Live formula = SOLD − max(0, IN STOCK). If In
    Stock shows a negative number (a LS data error), treat it as 0
    before calculating Need — we obviously do not have −2 units. Green
    fill (DDEDD3). The Need result itself can still be negative
    (overstocked); only the In Stock input is capped at 0.

-   ORDER column: Blank, yellow fill (FFFF00), for manual entry.

-   NOTES column: Blank, left for manual notes (also used for auto-flag
    reasons — see Auto-Flagging).

-   Do NOT include an "Archived Yes/No" column on any tab — redundant
    once data is split into Active/Archived tabs.

-   Formatting: Borders on all data cells, System ID AND UPC always
    formatted as text (never scientific notation/numeric), wrap text on
    any column wider than its content (narrow the column to match),
    freeze panes at row 3.

-   Column alignment (by content, applies to both report types): all
    columns CENTER aligned except Description (LEFT aligned), Vendor
    (LEFT aligned), and Category (RIGHT aligned). Column widths:
    auto-size to content for all columns. Description, Vendor, and
    Category will naturally be the widest.

-   Total row (reports without a Size Summary tab only): for categories
    with no sized items and therefore no Size Summary tab (e.g.
    adjustable one-size caps), add a bolded shaded TOTAL row directly
    below the header row (row 3) on every data tab that contains Sold,
    In Stock, Need, and Order columns — Active, No Data, Archived, By
    Category, By Vendor, and Flags. This pushes data start down to row
    4; freeze panes at row 4 accordingly. The TOTAL row sums Sold, In
    Stock, Need, and Order as live formulas across that tab’s own data
    range — Order updates live as quantities are filled in. Total row —
    Need column correction (applies to ALL tabs with a Total row): the
    TOTAL row’s Need sum must use SUMIF(Need range, ">0") rather than a
    plain SUM. Only POSITIVE per-row Need values are included —
    overstocked rows (negative Need) are excluded, so an overstocked
    item never masks or offsets real reorder need elsewhere on the same
    tab. This applies to: Active, No Data, Archived, By Category, By
    Vendor/By Description, and Flags tabs. Sold, In Stock, and Order in
    the Total row remain plain SUM — this correction is for the Need
    column only. Categories that DO have a Size Summary tab already get
    block-level totals there and do NOT get this sheet-wide Total row —
    it would be redundant. Non-Inventory items: in raw LS exports, if
    Quantity on Hand shows an apostrophe followed by a dash ('-), the
    item is Non-Inventory (e.g. firewood bundles, licenses) — LS doesn’t
    track stock for these. Do not flag as data errors or apply
    stock-based logic to them.

Category Sales Report

e.g., "ALL SOCKS," "ALL SUNGLASSES" — used when the report spans
multiple vendors within one product category.

-   Include a VENDOR column (vendor name) in the data — placed after
    UPC, before Vendor ID.

-   Title row: ALL [CATEGORY] — Report Run [date]

Vendor Sales Report

e.g., "PARADISE CAY," "NORTY" — used when the report is for one single
vendor.

-   Do NOT include a Vendor column — redundant since every row is the
    same vendor.

-   Put the vendor name in the Row 1 title alongside the date instead:
    [VENDOR NAME] — Report Run [date]

File Naming Convention

-   Every file name is prefixed with the initials of whoever is running
    the report: Dana = DP, Trevor = TJ, Jarrett = JW. If it’s not
    already clear from the conversation who’s running it, ask before
    naming the file. Do NOT duplicate: if the uploaded/existing file
    name already starts with a recognized initials prefix (DP/TJ/JW),
    keep it as-is — don’t add a second one.

-   Category reports: [INITIALS]_[CURRENT DATE]_CATEGORY_SALES 365 DAYS
    (e.g., TJ_8-12-26_ALL SOCKS_SALES 365 DAYS)

-   Vendor reports: [INITIALS]_[CURRENT DATE]_VENDOR_SALES 365 DAYS
    (e.g., JW_8-12-26_PARADISE CAY_SALES 365 DAYS)

-   Replace "365 DAYS" with the stated timeframe if the user specifies a
    different one.

-   LS Analytics report limit: 5,000 records max per report. Large
    categories may be split into multiple exports by Dana before upload
    — Sales reports (which include archived) need MORE splits than an
    Active-only inventory export of the same category. Check for
    multiple uploaded files covering the same report and merge them
    (dedupe on System ID) before formatting/flagging — don’t treat split
    files as separate reports.

-   LS Analytics reports run 24 hours behind (a report dated through
    8/13/26 really only reflects data through 8/12/26), while raw
    inventory exports are up-to-the-minute. This can cause small In
    Stock discrepancies between the two — not a data error, just timing.
    Don’t flag these mismatches.

-   Troubleshooting reRedelivery versioning — check this every time, not
    just when reminded. Before sending any file, ask: has this exact
    report already been delivered once in this session (even if the
    request that triggered the redelivery was unrelated — a correction,
    a new instruction, a follow-up tweak)? If yes, append ‘ v2’, ‘ v3’,
    etc. to the end of the file name (before the extension). The first
    delivery of a given report stays unversioned; every delivery after
    that is versioned, with no exceptions and without being asked. Do
    not rely on the person to notice and remind you — confirm this
    before every file is handed off.

Tabs — Full Structure

Tab order differs by report type. Tab CONTENT/definitions are the same
either way — only the order changes.

Category Report — tab order:

-   1. Size Summary — Clothing/Footwear/other sized categories only. See
    dedicated section below.

-   2. By Category — sorted Category then alphabetical Description, with
    Need descending as the secondary sort within each category group
    (highest need first, negatives last).

-   3. By Vendor — sorted Vendor then alphabetical Description, with
    Need descending as the secondary sort within each vendor group.

-   4. Overlap — only present when a cross-report comparison was
    explicitly requested for this report (see Cross-Report Overlap
    Comparison section). Sits here in the order when it exists; omitted
    otherwise.

-   5. Flags — ONLY the flagged rows (from Active + Archived), sorted
    Category then Description. No shading — kept black and white for
    easy printing.

-   6. Active — active items with real inventory, real sales, or both
    during the report period. Active items with zero sales AND zero
    stock are moved to the No Data tab instead.

-   6a. No Data — active items with zero sales AND zero stock for the
    report period, sorted Category then Description. Standard tab (not
    opt-in). Items here still go through Auto-Flagging and appear in the
    Flags tab if flagged — they are relocated out of Active, not set
    aside from review. Archived items with zero sales/stock stay in the
    Archived tab; this rule applies to active items only. Place directly
    after Active, before Archived. 7. Archived — archived items with
    real activity (Sold > 0 OR In Stock > 0) only. Archived items with
    both zero sales AND zero stock are partitioned into Archived – No
    Sales (Ignored) before processing begins. This tab may be empty —
    that is expected, not an error.

-   8. CRITICAL PROCESS ORDER — FIRST TWO STEPS, NO EXCEPTIONS: Before
    any parsing, flagging, size detection, or tab building runs, do
    exactly two things in order: (1) Partition every Archived row with
    BOTH zero sales AND zero stock into the Archived – No Sales
    (Ignored) tab — these rows are done, touch nothing else on them. (2)
    Partition every Active row with BOTH zero sales AND zero stock into
    the No Data tab — these rows are also done, touch nothing else on
    them. Only after both partitions are complete does any other
    processing begin (size detection, Auto-Flagging, Size Summary, sort
    tabs, etc.). These items are set aside permanently — do not ask
    questions about them, do not surface them for review during
    processing, and do not apply any further logic to them. They appear
    only on their designated tabs and nowhere else in the report.
    Archived – No Sales (Ignored) — DEFAULT, RUNS FIRST: immediately
    after reading the raw file (and after merging any split files into
    one dataset), partition off every archived row with BOTH zero sales
    AND zero stock into this tab, sorted Category then Description,
    before any other processing runs. Rows sent here never enter
    Auto-Flagging, never get Category/Gender/Size parsed, never enter
    the Size Summary, and never appear on By Category/By Vendor/By
    Description or Overlap comparisons. This is separate from the No
    Data tab — No Data holds active zero-sales/zero-stock items and goes
    through the full pipeline; Ignored holds archived
    zero-sales/zero-stock items and skips it entirely. Once the
    partition is done, formatting continues normally on the remaining
    data. The regular Archived tab holds only archived items with real
    activity (Sold > 0 OR In Stock > 0) and may end up empty — that is
    expected, not an error. This replaces the prior opt-in behavior and
    runs on every report by default. NOT the default; only when
    explicitly requested.

Vendor Report — tab order:

-   1. Size Summary — same definition as above (include ONLY if the
    category has sized items; omit entirely if not — By Category becomes
    the first tab in that case).

-   2. By Category — sorted Category then Description (every row is
    already the same vendor, so no Vendor grouping needed), with Need
    descending as the secondary sort within each category.

-   3. By Description (renamed from “Alphabetical”) — strictly
    alphabetical by Description, with Need descending as the secondary
    sort, no Vendor column. 4. Active — active items with real
    inventory, real sales, or both during the report period. Active
    items with zero sales AND zero stock are moved to the No Data tab
    instead. 4a. No Data — same definition as Category report No Data
    tab above. Place directly after Active, before Flags.

-   5. Flags — same definition as above.

-   6. Archived — archived items with real activity (Sold > 0 OR In
    Stock > 0) only. Archived items with both zero sales AND zero stock
    are partitioned into Archived – No Sales (Ignored) before processing
    begins. This tab may be empty — that is expected, not an error.

-   7. Archived – No Sales (Ignored) — DEFAULT, RUNS FIRST: immediately
    after reading the raw file (and after merging any split files into
    one dataset), partition off every archived row with BOTH zero sales
    AND zero stock into this tab, sorted Category then Description,
    before any other processing runs. Rows sent here never enter
    Auto-Flagging, never get Category/Gender/Size parsed, never enter
    the Size Summary, and never appear on By Category/By Vendor/By
    Description or Overlap comparisons. This is separate from the No
    Data tab — No Data holds active zero-sales/zero-stock items and goes
    through the full pipeline; Ignored holds archived
    zero-sales/zero-stock items and skips it entirely. Once the
    partition is done, formatting continues normally on the remaining
    data. The regular Archived tab holds only archived items with real
    activity (Sold > 0 OR In Stock > 0) and may end up empty — that is
    expected, not an error. This replaces the prior opt-in behavior and
    runs on every report by default.

Auto-Flagging

Runs automatically as part of formatting, before naming. Do this without
being asked, every time a file is formatted:

-   Duplicates — flag rows that match on: (a) Same Vendor ID, or (b)
    Same/near-identical Description + Category (even if System ID/Vendor
    ID differ), or (c) Same UPC (see UPC match rule below). When writing
    the NOTES entry for any duplicate flag, use this exact format:
    "Duplicate – matches row [N] on [Tab Name] tab ([reason])." Always
    reference the Active or Archived tab only — never the sort tabs (By
    Category, By Vendor, By Description, or Size Summary). The
    Active/Archived tab reference immediately tells Dana whether the
    matched item is active or archived — no separate label needed. The
    reason should be specific: "same description," "same Vendor ID,"
    "same UPC," or a combination. Examples: "Duplicate – matches row 14
    on Archived tab (same description). Zero sales, zero stock — review
    whether this item should also be archived in LS." / "Duplicate –
    matches row 22 on Active tab (same Vendor ID). Review which listing
    to keep — consider merging in LS." / "Duplicate – matches row 8 on
    Active tab (same UPC). Likely re-listing — verify and consolidate in
    LS." Both matched rows get a note — each points to the other’s row
    and tab. Scope — Active-only: only flag a duplicate when BOTH
    matched rows are Active. If either matched row is Archived
    (Active+Archived or Archived+Archived), skip the duplicate flag
    entirely — archived-side matches are not worth surfacing for review.

-   Exception — Variants: if Size, Color, or Style differs between two
    otherwise-matching rows, do NOT flag as duplicate — these are
    distinct SKUs. Recognized variant attributes include Size/Color (see
    dictionary below) and Style words: V-NECK, CREW NECK,
    FULL/HALF/QUARTER ZIP, HOODED, RAGLAN, VINTAGE, DISTRESSED, TANK,
    CROP.

-   Camping hard goods exception: for the categories covered in Size
    Summary Step 5 (Coolers, Tents, Canopy/Umbrella/Gazebo, Chairs &
    Tables, Bedding), capacity, dimension, person-count, and chair/table
    Type also count as recognized variant attributes — don’t flag two
    items as duplicates solely because their capacity/dimension/type
    differs.

-   Legacy Vendor-ID-in-Description: on old items, the real Vendor ID
    was sometimes typed as a trailing number at the end of the
    Description instead of the Vendor ID field (e.g. "Socks Boys No
    Shows (S) 71295"). A typo in that number can split one item into two
    unrelated-looking listings. When scanning for duplicates, also
    extract trailing numeric codes from Description and cross-reference
    against other items’ codes/Vendor IDs, especially for older listings
    with a blank Vendor ID field.

-   UPC match: matching UPC across two listings (even with differing
    description text) is a strong duplicate/re-listing signal on its
    own, independent of Vendor ID/description matching. Exception —
    vendor single-UPC style variants: some vendors (confirmed: Royal
    Resortwear) issue one UPC across multiple genuinely distinct style
    variants of the same base product (e.g. Lifeguard Hat with Leather
    Patch vs. Woven Patch — same UPC, different patch design). When two
    rows share a UPC but a visible style attribute clearly differs in
    the Description (not just color), do NOT flag as a duplicate — the
    standard variant exception applies even when the match signal is UPC
    rather than Vendor ID or Description. Exception —
    Print/Graphic/Character/Flavor Variants: if two or more items share
    the same Vendor ID (or UPC) but differ in printed graphic,
    character, or flavor variant (e.g. different plush animal
    characters, different blanket prints, different snack flavors), and
    the differentiator is visibly named in the Description, do NOT flag
    as duplicates — treat the same as a Style-word variant. Confirmed in
    PlazaTex (blanket prints), Sona Enterprises (plush characters), Orb
    Factory (flavor variants, single shared UPC). Addition — UPC signal:
    same-Vendor-ID items where each item carries its own distinct,
    nonzero UPC are treated as the Print/Graphic/Character/Flavor
    Variant exception automatically, regardless of how much description
    text differs between them. A shared "assorted line" Vendor ID with
    per-design UPCs is a strong standalone signal that these are
    separate real SKUs, not a duplicate or re-listing — this applies
    even when the differing description text is longer than a single
    word or short phrase. This does NOT override the same-UPC duplicate
    check: if two items share both Vendor ID AND UPC, they are still
    evaluated as a potential duplicate, since a shared UPC indicates a
    true re-listing rather than a distinct product.

-   "Possible Variants — Verify" tab (additive, created only when at
    least one pair exists): when a same-Vendor-ID or same-UPC pair
    shares an identical size/base description after known size words are
    stripped, but differs by a short unrecognized word or phrase (likely
    an uncatalogued color, print, or theme name not yet in the
    Duplicate-Detection Color & Style Dictionary), do NOT hard-flag it
    as a Duplicate and do NOT silently suppress it. Instead, list it on
    this separate tab in a four-column format: Item A | Item B |
    Differing Word(s) | Category. This tab sits after the standard tab
    set. Confirmed necessary on large multi-category vendors (World
    Famous Sports) where the color/print vocabulary is too extensive to
    fully catalog in advance — this is a middle ground between
    over-flagging every uncatalogued color word as a duplicate and
    silently auto-approving unverified pairs. Pipeline corrections
    confirmed and reflected in all delivered files: (a) Numeric size
    variants — items differing only by shoe size number (e.g. SZ 6 vs
    SZ 7) or decimal half-sizes (e.g. 11.5) are legitimate size
    variants, NOT duplicates; parenthetical dual-size labels (e.g. "Size
    (11/12)") are one combined half-size label, not two separate
    sizes. (b) Youth shoe-size progression — for ranges like "Youth Sz
    13–6," order size rows as 13, 1, 2, 3, 4, 5, 6 (matching real youth
    progression where 13 precedes 1), not plain ascending numeric
    order. (c) Missing Size Breakdown flags must always surface on the
    Flags tab, not just in the NOTES column. (d) Sheet-wide Total row
    (SUMIF-positive Need) appears only on reports without a Size Summary
    tab; reports with a Size Summary tab do not get this row (already
    handled at block level). Mis-vendor items: if a row’s Default Vendor
    clearly does not match the vendor being reported on (e.g. a
    non-Brentwood item appearing in a Brentwood vendor report), flag it
    with a note in the NOTES column: “Mis-vendor — Default Vendor is
    [vendor name], not [expected vendor]. Verify correct file or
    reassign in LS.” Place it on the Flags tab like any other flagged
    row. Do NOT create a separate mis-vendor tab — all flags go on the
    Flags tab, no exceptions. Missing Category — if an item’s Category
    field is entirely blank in the raw export, flag it in NOTES:
    “Category missing in LS — verify/correct.” Do not guess a category
    or leave the item ungrouped — place it in a “(No Category)” group on
    the sort tabs so it is visible and easy to find. Miscategorization —
    flag rows where the Description clearly doesn’t match its Category.
    Use judgment on wording, not just keyword matching.

-   Archived item shows In Stock > 0 — LS is supposed to zero out stock
    when an item is archived, so any archived item still showing stock
    is a data error. Flag it (note explains stock should be zero,
    verify/correct in LS). Fix confirmed: unarchive then re-archive the
    item in LS to correctly wipe the stock.

-   Zero Activity (Active items) — flag ACTIVE (non-archived) items
    showing Sold = 0 AND In Stock = 0 for the report period. These items
    are placed on the No Data tab (not the Active tab) and still go
    through Auto-Flagging normally. Note: “Zero sales, zero stock —
    review whether this should be archived in LS.” This is the mirror
    image of the Archived-Stock-Error flag above (that one catches
    archived items that still show stock; this one catches active items
    that show nothing at all). Does not apply to items already on the
    Archived or Archived – No Sales (Ignored) tabs — archived items are
    excluded from this flag (Ignored items are partitioned off before
    Auto-Flagging runs). On a Multi-Store Merge (SLS + SLH) report,
    evaluate the combined SLS+SLH total instead of SLS alone — see that
    section.

-   Output: on any flagged row, write the reason + a suggested fix (if
    obvious) into the NOTES column, and shade that entire row light
    green. Copy every flagged row into the Flags tab as described above.

Step 7 — Type/Product Line Grouping (Toys and other non-sized, multi-line categories): When a vendor’s items have no traditional sizes but belong to distinct product lines (detected from a consistent prefix in the Description, e.g. "PINCHER PALS", "SLIME N STRETCH", "WATER HOOPLA"), build the Size Summary by TYPE/PRODUCT LINE instead of by size. Rename the "SIZE" column header to "TYPE" in the Size Summary tab. Each product line = one aggregate row showing total Sold, In Stock, and per-SKU SUMIF Need across all SKUs in that line. In the By Category, By Description, and Active tabs, group items by product line: add a blue group header row for each product line, followed by a TOTAL row at the top of the group, then individual items sorted by Need descending as the secondary sort within each group. Secondary Need sort (all data tabs): within every group or category section on every data tab, sort items by Need descending as the secondary sort key — highest need first, negatives (overstocked) last. This is baked into every tab automatically; no separate "By Need" tab is created. Duplicate-Detection Color & Style Dictionary

Non-standard/vendor-specific color names confirmed against real data
(living list — add more as they’re found, especially from Planet
Cotton):

-   CAMEL = beige, FLO BLUE = Carolina blue, MELON =
    cantaloupe/orange-ish, GLACIER = light blue, NEON GREEN = very
    bright green, OCHRE = between yellow and brown, SAGE = light green,
    YAM = burnt orange, PEACH, FUSCHIA/FUCHSIA.

-   Phrase-colors: DARK GRAY/GREY, PURPLE FROST, TURQUOISE FROST,
    FUSCHIA FROST — the "___ FROST" pattern is a Planet Cotton naming
    convention; expect more. Color-modifying prefixes — DRK (dark) and
    ROYAL Additional confirmed colors (World Famous Sports): BRASS,
    CHARCOAL, MINT, GRAPE, SLATE, MERLOT, CORAL, MARINE — all standalone
    color words. Additional color-modifier prefix: WASHED (e.g. "WASHED
    BLACK" = a washed finish of black, not a separate product).: treat
    these as recognized color modifiers, not stand-alone words — e.g.
    "DRK RED" = Dark Red, "ROYAL LT BLUE" = Royal Light Blue. Confirmed
    in Cascade Mountain Tech's lantern line. Items differing only by
    these modified color names are variants, not duplicates.

Cross-Report Overlap Comparison

Once several formatted reports exist, a user may say something like:
"Compare Category report ‘ALL SOCKS’ with Vendor reports [list] (except
[vendor names]) to look for overlap on the same type of [product]."

-   Goal: find items across the named reports that look like the same
    real-world product carried under multiple vendors/listings — not
    just exact matches.

-   Match primarily on Description and Category (fuzzy match), not
    System ID or Vendor ID.

-   Exclude any vendors the user names as exceptions from the comparison
    entirely.

-   Matches found within the SAME vendor should be flagged as duplicate
    listings, not skipped.

Output — Overlap Tab Layout

Columns: Source | Vendor | Description | Cost | Sold (365d) | In Stock |
Last Sold | Note. Row 1 = title (merged). Row 2 = a short italic legend
line explaining the color coding. Row 3 = bold column headers (gray
fill), frozen so they stay visible while scrolling.

-   Group title row: one per product-type group, merged across all
    columns, bold white text on a blue fill — e.g. “Adult
    2X/4X/6X-Capacity Life Jackets (90+ lbs).”

-   Total Needed row directly under the group title, merged and
    highlighted YELLOW: “Total Needed across all vendors in this group
    (Sold − In Stock, positive only): [N] unit(s).” This is
    vendor-agnostic — it sums NEED = max(0, Sold − max(0, In Stock))
    across EVERY item in the group, regardless of vendor, so Dana can
    see the real combined reorder need before deciding who to order it
    from.

-   No vendor recommendation, no “lowest cost pick” callout, and no
    consolidation/replacement-quantity suggestion — this was tried and
    explicitly removed. Vendor choice depends on things this data
    doesn’t contain (minimum order quantities, free-shipping thresholds,
    brand-new show-special vendors with zero sales history) and Dana’s
    active strategy of consolidating to fewer SKUs/vendors rather than
    chasing per-unit savings. The tab shows the numbers; it does not
    pick a winner.

-   Cost cell highlight only (not a full-row callout): among items with
    a verified nonzero Cost AND (Sold ≠ 0 OR In Stock ≠ 0) — i.e.
    “live,” not stale — highlight just the Cost cell of the single
    lowest-cost item light green and bold. This is informational only,
    not a recommendation.

-   Item rows: any row with a missing/zero Cost, OR with zero sales AND
    zero stock, is grayed out with a Note explaining why (“Cost missing
    — excluded from comparison” or “Zero sales, zero stock — likely
    discontinued, excluded from comparison”). These excluded rows still
    display in full — nothing is hidden — and they don’t count toward
    Total Needed being misleadingly low, since their own NEED is 0
    anyway.

-   Blank spacer row between groups. Page setup: landscape,
    fit-to-width, header row (row 3) repeats on every printed page.

Purpose: lets Dana see the true combined need for a product type across
every vendor selling it, and spot the cheapest currently-active option
at a glance — without the tool pretending it knows enough to pick a
vendor for her.

Multi-Store Merge (SLS + SLH)

For vendors carried by both Shaver Lake Sports (SLS) and Shaver Lake
Hardware (SLH), when explicitly requested, merge SLH’s sales data into
the SLS-based Vendor Report.

-   SLH doesn’t run the same LS Analytics export — its numbers come from
    an Item Search/register report instead, which lists Description,
    Stock, and Sold but no System ID, UPC, or Vendor ID.

-   Match each SLH line to the corresponding SLS catalog row by
    Description. Where the match is ambiguous (multiple SLS color/size
    variants could apply, or an SLS item is archived with zero sales and
    zero stock at SLS while SLH shows real activity), ask before
    proceeding rather than guessing.

-   Add two new columns, SLH Sold and SLH In Stock, and rename the
    existing Sold/In Stock columns to SLS Sold/SLS In Stock for clarity.

-   The Need column becomes a combined live formula: (SLS Sold + SLH
    Sold) − (SLS In Stock + SLH In Stock).

-   If SLH carries an item that isn’t in the SLS catalog at all, add it
    as a new row with whatever fields are actually available
    (Description, inferred Category, SLH Sold/In Stock) — leave System
    ID, UPC, Vendor ID, and Cost blank, and note in NOTES that it’s
    SLH-only with no SLS catalog match.

-   Archived items with zero sales AND zero stock at SLS stay excluded
    from all flagging, sort tabs, and this merge process entirely — dead
    stock at SLS doesn’t need cross-referencing against SLH.

-   The Zero Activity flag evaluates the combined SLS+SLH total, not SLS
    alone, for merged reports — an item with real SLH sales isn’t
    actually dormant even if SLS shows nothing.

Size Summary Tab (Clothing, Footwear, and other sized categories)

Step 1 — Determine Gender

Check the Category path first, then the Description. Recognized variants
(verified against real data — do not add unverified guesses):

-   Womens: WOMENS, WMNS, LADIES, WOMAN, WMN

-   Mens: MENS, MEN

-   Boys: BOYS, BOY | Girls: GIRLS, GIRL

-   Youth: YOUTH, YTH | Kids: KIDS | Toddler: TODDLER | Infant: INFANT.
    Month-based infant/toddler size markers also trigger the
    Kids/Infants override even when none of the literal keywords
    (INFANT, TODDLER, KIDS, BABY, CHILDREN) are present. Recognized
    patterns where # = any number: #MO (e.g. 6MO, 18MO), # MO (e.g. 6
    MO, 12 MO), MO-# (e.g. MO-18, MO-24), #-MO (e.g. 18-MO), # MONTH or
    # MONTHS (e.g. 6 MONTHS, 24 MONTHS), #M where # is a recognized
    infant size number (3, 6, 9, 12, 18, 24) — e.g. 6M, 18M (note: plain
    M alone, or M on an adult garment, is not an infant marker — use
    context). Any of these patterns anywhere in the description = Kids -
    Infants subcategory.

-   Unisex: UNISEX | Juniors: JUNIORS

-   If none found, use "Unisex/Unspecified."

Step 2 — Determine Size

Check the Category path first (many categories already break out size,
e.g. Jackets/Womens/Large). If not found there, check the Description in
this exact order — stop at the first match, never let a later rule
override an earlier match:

-   (a) "SZ ##" keyword

-   (b) "SIZE ##" keyword

-   (c) Letter sizes: SMALL/SM, MEDIUM/MED/MD, LARGE/LG,
    XL/XLARGE/X-LARGE, XS/XSMALL, XXL, 1XL–5XL, ONE SIZE — plus T-sizes
    ("4T") and Month-sizes ("12 MONTH"). Note: hyphenated "XX-LARGE" and
    "X-SMALL" do not appear in real data — only unhyphenated forms plus
    "X-LARGE."

-   (d) ONLY if nothing above matched: a number glued directly to a
    hyphen-then-letters (e.g. "8-CHOC" in "SKAMANIA - MENS - 8-CHOC/DK
    TAUPE"). This pattern is UNRELIABLE (~50% false-positive rate
    against vendor codes and phrases like "2-piece") — matches from this
    step are NOT trusted into the Size Summary; instead flag as
    "possible size — needs verification" in the Flags tab.

-   If no size can be determined, OR the item is a single-UPC "Assorted
    Sizes/Colors" listing, exclude it from the Size Summary and flag as
    "Missing Size Breakdown" in the Flags tab.

-   Known gap: youth age-based sizes like "12Y"/"6YR" are not yet
    covered by any rule (low priority). CLOTHING/SOCKS — Shoe-size range
    detection: socks are sized by shoe-size range, not standard clothing
    sizes. Detect the full range from the description — do NOT truncate
    to just the first number. Recognized patterns and their Size Summary
    labels: "AGES 7-10" or "SIZE 7-10" → Kids 7-10; "AGES 4-8" or "SIZE
    4-8" → Kids 4-8; "SIZE 8-12" or "CREW SIZE 8-12" → Mens 8-12; "SIZE
    9-13" or "SIZE 10-13" → Mens 9-13 (or 10-13 as applicable); "SIZE
    5-11" or "SIZE 6-9" or "SIZE 9-11" → Womens (with the range in the
    label). Each shoe-size range = one aggregated Size Summary row; Need
    = SUMIF of positive per-SKU needs (not net Sold minus total Stock).
    "Missing Size Breakdown" flag must NOT fire on any item where a
    shoe-size range is clearly present in the description. One Size / OS
    items in CLOTHING/SOCKS go in their own "One Size / OS" row.
    Full-range detection: always capture the complete range before
    falling back to single-number parsing (e.g. "SIZE 6-8 1/2" → full
    range 6-8½, not truncated to "SIZE 6"). For ranges that fall between
    or across confirmed sock buckets, bucket into the nearest confirmed
    range rather than inventing a new one. Confirmed guidance: "6-8 1/2"
    buckets into Kids 4-8, not Kids 7-10 (overlap zone favors the lower
    confirmed bucket). FOOTWEAR/BOOTS — bare trailing number as shoe
    size: for items under any FOOTWEAR/BOOTS category, if neither "SZ
    ##" nor "SIZE ##" is found, check for a bare number at the end of
    the Description and trust it as the shoe size (e.g. "SUGAR LOAF
    BOOT - 10" → size 10; "TOASTY CAMO BOYS 9 BOOT" → size 9). Do NOT
    flag these as "Missing Size Breakdown." Womens shoe width-size
    notation: numbers directly followed by a width letter (e.g. "8M,"
    "9W," "10N") in footwear descriptions represent shoe-size + width
    format (M=Medium width, W=Wide, N=Narrow) — NOT infant month
    markers. In FOOTWEAR categories, #M is always shoe-size + medium
    width, never a month marker. Confirmed in Rocket Dog. Do not flag
    shoe-size+width items as "Missing Size Breakdown" — parse the
    numeric portion as the shoe size and note the width as a variant
    attribute. Exception — slash-joined half sizes: if two numbers
    appear joined by a slash at the end (e.g. "SZ 11/12"), treat as one
    combined half-size label (11/12), not two separate sizes. Exception
    — youth shoe-size progression: for "Youth (Sz 13-6)"-style ranges,
    order size rows as 13, 1, 2, 3, 4, 5, 6 — matching real youth
    shoe-size progression (13 comes before 1) rather than plain
    ascending numeric order.

Step 3 — Group into Gender + Subcategory

Subcategory = the Category path with the top-level (Clothing/Footwear)
and any Gender/Size segments stripped out (e.g.
FOOTWEAR/BOOTS/WINTER/MENS → "Boots / Winter"). Each unique Gender +
Subcategory combination becomes its own block in the tab (e.g. "Mens /
Water Shoes," "Womens / Hiking Boots"). Sort order for blocks: (1)
top-level category FIRST Category-grouped Size Summary (opt-in, not
default): when explicitly requested, build the Size Summary grouped
strictly by Gender + Category (rather than the standard Gender +
Subcategory-with-path-stripping). One block per Gender + Category (e.g.
"Girls Socks," "Womens Socks") even when most items are Assorted
Sizes/Colors. Within each block: items with a real detected size get
their own size row; items with no detectable size roll into a single
"Assorted / No Size Breakdown" row in the SAME block and still
contribute to that block's Sold, In Stock, and positive-only Need
totals. Use only when Dana explicitly asks for category-level grouping.
Mixed sizing — sized and unsized items coexist: within any Size Summary
block, items WITH detectable sizes get their own individual size rows
(standard behavior); items with NO detectable size in that same block
are aggregated into a single "Assorted / One Size" row at the bottom of
the block (see Step 4). Every block appears in the Size Summary
regardless of whether it contains sized items, unsized items, or both.
This means a vendor with cowboy hats in S/M/L/XL AND lifeguard hats that
are One Size gets both properly: the Cowboy Hat block shows size rows,
the Straw & Lifeguard block shows one "Assorted / One Size" row. When
ALL items in a vendor or category have no detectable size, derive TYPE
groups from the LS Category subcategory path (e.g. CLOTHING/HATS/STRAW &
LIFEGUARD → "Straw & Lifeguard Hats") and rename the Size Summary column
header from "SIZE" to "TYPE." Never flag One Size items as "Missing Size
Breakdown" — they always have a home in the Size Summary. — the segment
before the first "/" in the LS Category path (e.g. CAMPING, CLOTHING,
FOOTWEAR, WATERSPORTS) — so all items from the same top-level category
stay grouped together; (2) then subcategory alphabetically within each
top-level group. NEVER sort on the full category path string as one unit
— that mixes Camping blocks with Clothing blocks mid-tab.

CLOTHING / HATS / BRIMMED — Special Rules (applied after Step 3): For
items in CLOTHING/HATS — TYPE and SUB CATEGORY rules (replaces
CLOTHING/HATS/BRIMMED; "Brimmed" is retired as an LS subcategory). New
flat path: Clothing/Hats/[subcategory] — never nested further. TYPE
KEYWORD DICTIONARY — verified typos/abbreviations (specific entries
only): STAW → STRAW; DRIFER → DRIFTER; OTBCK → OUTBACK; BUCKETT →
BUCKET. New typo variants flagged and reviewed individually before being
added here. TYPE PRIORITY ORDER — top to bottom, stop at first match:
(1) COWBOY → Type = Cowboy Hat (overrides material — straw cowboy hat is
Cowboy Hat, never Straw-Lifeguard). (2) STRAW or LIFEGUARD (non-cowboy)
→ Type = Straw-Lifeguard. The Straw-Lifeguard subcategory covers both
straw hats and lifeguard hats — any hat with LIFEGUARD in the
description goes here, regardless of whether it is also straw. (3)
BOONIE, BOONIES, or BUCKET → Type = Bucket Hat. (4) FLAP or MOJAVE →
Type = Flap Hat. (5) Kids/Infants override applies AND no match above →
Type = real style name if identifiable, else Type Unclear. Never forced
to Bucket Hat. (6) FLOPPY or SUN HAT/SUNHAT + Womens/Ladies → Type =
Floppy Hat or Sun Hat. (7) Any other identifiable style name with no
dedicated LS subcategory → Type = Bucket Hat (catch-all). (8) No
identifiable style word → Type Unclear – needs verification. SUB
CATEGORY PRIORITY ORDER — top to bottom, stop at first match: (1)
Kids-Infants (FIRST — overrides all): INFANT, KIDS, CHILDREN, CHILD,
TODDLER, BABY, or any month-based infant size marker → Sub Category =
Kids-Infants. (2) COWBOY → Sub Category = Cowboy. (3) STRAW or LIFEGUARD
→ Sub Category = Straw-Lifeguard. (4) FLOPPY or SUN HAT/SUNHAT +
Womens/Ladies → Sub Category = Ladies Sun Hats. (5) FLAP or MOJAVE → Sub
Category = Flap. (6) Everything else → Sub Category = Bucket
(catch-all). STRAW or LIFEGUARD → Straw - Lifeguard. FLOPPY (when Gender
= Womens or Ladies) → Ladies Sun Hats. FLAP → Flap. COWBOY → Cowboy.
BOONIE or BOONIES → Boonies. (2) TYPE KEYWORD DICTIONARY — verified
typos/abbreviations (specific entries only, not general fuzzy matching):
STAW → Straw Hat (typo for STRAW); DRIFER → Drifter Hat (typo for
DRIFTER); OTBCK → Outback Hat (abbreviation for OUTBACK). New typo
variants found in future data get flagged and reviewed individually
before being added here. Step 4 — Build Each Block

-   TOTAL row at the TOP (not bottom) of each block, bolded/shaded to
    stand out.

-   Total Sold and Total In Stock = straight sum across all sizes in the
    group.

-   Total Need = sum of ONLY THE POSITIVE per-size Need values — sizes
    with negative Need (overstocked) are excluded from the total, so
    overstock in one size never offsets real ordering need in another
    size. Per-size Need uses max(0, In Stock) as the input — negative In
    Stock counts as 0. CRITICAL — Per-size-row Need when multiple SKUs
    share a size: when a size row aggregates more than one SKU (# SKUs >
    1), the Need value for that row = SUMIF of positive
    per-individual-SKU Needs, NOT net (Total Sold − Total In Stock) for
    the group. Netting across SKUs causes overstocked items to mask
    understocked ones and produces wrong totals. Example: Mens 8-12
    socks — 22 SKUs, Sold=46, Stock=67. Net would show Need=−21 (floored
    to 0 by SUMIF), hiding 23 real units of reorder need. Correct: SUMIF
    of per-SKU needs = 23. The same SUMIF logic applies to the "Assorted
    / One Size" row when it aggregates multiple unsized SKUs. Block
    TOTAL Need = SUMIF of positive per-size-row Needs, which is correct
    only when each size row's Need is itself already a SUMIF of per-SKU
    positives.

-   Individual sizes listed below the Total row, in logical order
    (XS→5XL, or ascending numeric for shoe sizes). Assorted / One Size
    row: within any block, items that have no detectable size (would
    otherwise trigger "Missing Size Breakdown") are NOT flagged —
    instead they are aggregated into a single "Assorted / One Size" row
    at the BOTTOM of that block, contributing to the block's Sold, In
    Stock, and positive-only Need totals normally. This applies whether
    the block has other sized rows above it (mixed block) or contains
    only unsized items (pure One Size block). Never leave a block empty
    and never flag One Size items as missing a size — every item has a
    home in the Size Summary. Aggregation (CRITICAL): within each block,
    ALL SKUs sharing the same size value are collapsed into ONE row —
    sum their Sold, In Stock, and Need values; populate # SKUs with the
    count of distinct items. Do NOT list individual color, style, or
    variant rows separately. The Size Summary shows total need by SIZE
    only — color and style breakdowns belong on the By Category/By
    Vendor tabs, not here. Exception — price-variant hard goods: for
    Camping hard-goods categories where same-size/same-type SKUs carry
    meaningfully different costs (confirmed so far:
    Canopy/Umbrella/Gazebo and Chairs & Table), do NOT collapse them
    into one aggregated row. Instead, list each SKU as its own row with
    its own Sold/In Stock/Need, grouped under the shared size/type label
    for readability. Different footprints or types at the same nominal
    classification are genuinely different products, not
    interchangeable. If a new category surfaces the same issue (same
    nominal size/type but meaningfully different costs across SKUs), add
    it to this exception list rather than aggregating and hiding
    per-item Need. This exception overrides the standard aggregation
    rule above specifically for these categories.

Purpose: the Total-at-top format lets Dana (or whoever’s buying)
instantly triage at a vendor booth — high Total Need is worth hunting
for a source; low/negative Total Need is safe to skip if nothing’s
readily available.

Step 5 — Non-Apparel Dimensional/Type Categories (Camping Hard Goods)

Applies to: Camping/Bedding, Camping/Canopy Umbrella Gazebos Screen
House Arbors, Camping/Chairs & Table - All Types, Camping/Coolers,
Camping/Tents. Skip Step 1 (Gender) for these. Replace Step 2 (Determine
Size) with the category-specific rules below, verified against the
past-365-days Camping category export (8/16/26). Steps 3 and 4 (grouping
into blocks, Total-at-top format, positive-only Need sum) work the same
way, using whichever value is detected below (capacity, dimension, or
type) as the “size.”

Coolers — capacity, checked in this order:

-   Number + L/LITER/LITERS (e.g. “30L,” “17 Liter,” “10L”) — confirmed
    size; never flag as uncertain. Number + QT/Q/QUART/QUARTS (e.g. “30
    QUART,” “48QT,” “52QT,” “50 Quarts”) — confirmed size; number is
    variable (any value)

-   Number + CAN/CANS (e.g. “16 CAN,” “42 CAN”)

-   Number + GAL (e.g. “5GAL”)

-   If none of the above capacity formats found: LxWxH dimension string
    in inches IS the confirmed size for soft/backpack coolers and
    insulated bags (e.g. “13.4 X 8.8 X 10.6,” “17X16X7,” “17.3 X 11.8 X
    12.6”). This is a legitimate confirmed size — do NOT flag as
    “possible size — needs verification.” Treat the full dimension
    string as the grouping value.

Tents — capacity, checked in this order:

-   Category subpath first (e.g. TENTS/4 MAN → 4 Person)

-   Number + PERSON/PER/MAN in Description (e.g. “4 PERSON,” “6 PERSON,”
    “1 PERSON,” “4 MAN”)

-   If none found: LxWxH dimension string fallback (e.g. “9X7X72”) —
    flag as “possible size — needs verification,” same as above.

-   Accessories with no person-count or dimension (stakes, poles, repair
    kits, mallets) — these aren’t sized units; exclude from the summary,
    no flag.

Canopy, Umbrella, Gazebos, Screen House, Arbors — footprint/diameter:

-   Number X Number = footprint in feet (e.g. “10 X 10,” “12 X 12”)

-   Single Number’ or Number FT = umbrella/shelter diameter (e.g. “6’,”
    “7’ UMBRELLA,” “6.5’ BEACH UMBRELLA”)

-   Accessory items with no dimension (e.g. replacement chair umbrellas)
    — exclude, no flag.

Chairs & Table — All Types — TYPE, not physical dimension (most chairs
carry no dimension at all — this category groups by what the item IS).
The Category subpath (Director/Beach/Stools/Tables) is only reliably
applied to some listings, so detect Type from the Description first and
use the subpath only as a confirming hint. Check in this order, stop at
first match:

-   Kids/Child: KIDS, CHILD, JR, JUNIOR

-   Director: DIRECTOR

-   Beach: BEACH

-   Stool: STOOL

-   Big Boy/Oversized: BIG BOY, OVERSIZED, JUMBO, GORILLA, “BIG ___,”
    COMFORT CHAIR

-   Rocking/Armchair: ROCKING, ARMCHAIR

-   Captain: CAPTAIN

-   Zero Gravity/Lounger: ZERO GRAVITY, ANTI-GRAVITY, LOUNGER, RECLINING

-   Backpack Chair: BACKPACK

-   Quad: QUAD (only if nothing above matched — Quad often combines with
    Kids or Big Boy, which take priority)

-   Table: TABLE (not a chair-with-table combo like “Director Chair with
    Table,” which stays in Director) — sub-split Tables further by size
    using the Canopy dimension rule above (FT or LxWxH)

-   No keyword match (e.g. plain “FOLDING CAMP CHAIR”): group as
    “Standard Folding Chair.” Do NOT flag as Missing Size Breakdown — a
    chair with no distinguishing type is a normal, real listing, not
    missing data.

Bedding — patterns differ by subcategory, so split by subcategory:

-   Air Mattresses & Sheet Sets: primary grouping = bed-size word (TWIN,
    FULL/DOUBLE, QUEEN, KING, CAL KING). Within each bed size, sub-group
    further if the description contains (a) a height/thickness
    measurement — any number followed by ", IN, or INCH (e.g. '8.75"',
    '20"', '3 INCH') — or (b) a type/quality descriptor (TOUGH GUARD,
    DUVET TOP, PILLOW TOP, RAISED, ELEVATED, BUILT-IN PILLOW, COMFORT
    TOP, VELVET, PLUSH — add more as found). Combine as '[Bed Size]
    [Height]" (e.g. 'Queen 8.75"', 'Queen 20"') or '[Bed Size] [Type]'
    if no height but type differs. Never lump different heights or type
    tiers into the same group — a $14 basic queen and a $90 duvet-top
    queen are different products that need separate ordering decisions.

-   Blankets/Throws, Pads: LxW dimension in inches (e.g. “51 X 80,”
    “54”X68”,” “50X60” — formats vary: with/without quote marks,
    with/without spaces around the X)

-   Sleeping Bags: LB weight (e.g. “4 LB,” “5LB,” “1.45 LB”) and/or
    DEGREES temperature rating (e.g. “30 DEGREES”) is the real size
    signal here, not physical dimension — use weight as the grouping
    value when present, degrees as secondary

-   Cots, Hammocks, Pillows: no reliable size pattern in real data —
    exclude from the summary, no flag (one-size is normal for these).

Note: this is a first pass verified against the past-365-days Camping
category export (8/16/26). Treat it as a living list — expect gaps
outside the patterns above, same as the clothing rules.

Step 6 — Life Jackets / Life Vests (Human + Pet)

Applies to: WATERSPORTS/LIFE JACKETS (and its subpaths) and PET
ACCESSORIES/PET LIFE JACKETS. Verified against the full Life Jackets +
Pet Life Jackets category export (8/18/26) — archived items showing zero
stock were excluded from the sample before verifying patterns (stale
listings, shouldn’t drive the rules).

WATERSPORTS/LIFE JACKETS (human) — the Category subpath already IS the
size value for almost every active item:

-   Use the Category subpath directly as the size grouping — e.g. “ADULT
    LG XL,” “ADULT SM MED 90+ LBS,” “ADULT 2X 4X 6X,” “CHILD 30 -
    55LBS,” “INFANT - UNDER 30 LBS,” “TEEN OR ADULT PETITE 75 - 125,”
    “YOUTH & JR 50-90 LBS.” No separate Gender step needed — each
    subpath value is its own block, same as a clothing Subcategory
    block.

-   If the item sits at the bare WATERSPORTS/LIFE JACKETS level (no
    subpath): check the Description for an age/size word (ADULT, YOUTH,
    TEEN, CHILD) plus a letter size (S/M, etc.) — group under the
    matching bucket if found.

-   If neither the subpath nor the Description gives a size (e.g. “MIT
    SELF INFLATE LIFE JACKET,” “HEADS UP WINNING EDGE”): these are
    universal/one-size inflatable models — exclude from the summary, no
    flag (same treatment as one-size camp chairs in Step 5).

PET ACCESSORIES/PET LIFE JACKETS — separate category (not under
Watersports). Uses the same letter-size vocabulary as clothing Step
2(c), plus pet-specific abbreviations confirmed in this data:

-   Add to the recognized letter-size dictionary (Step 2(c)) for this
    category: LRG (= Large), XLRG (= XL), XSM (= XS). Also confirmed
    here: hyphenated X-SMALL — appears in real data for Pet Life
    Jackets, unlike Clothing/Footwear where it doesn’t.

-   Weight ranges sometimes appear alongside the letter size (e.g.
    “15-30 LBS,” “60-80 LBS”) — treat as supplementary detail, not the
    primary grouping; group by letter size.

-   One-off: “OVERTONS LIFE JACKET L DOG” uses a bare single letter “L”
    for Large. A lone letter is too high a false-positive risk to add as
    a general rule — flag this one as “possible size — needs
    verification” instead of trusting it into the summary.

Steps 3 and 4 (grouping into blocks, Total-at-top format, positive-only
Need sum) apply the same way for both categories above.

Recommendations Tab

Goal: lean out inventory and double down on what actually turns, using
the same buying-decision logic already proven out manually for
Souvenirs/Stickers and the Lazy One vendor line. Runs automatically as
part of formatting whenever the raw file includes at least 3 full
periods (years or 365-day windows) of comparable Sold history for the
same items — a single-period Sold column alone is not enough data to
call a turn rate. If only one period is available, skip this tab and
note in the chat that multi-period history is needed to generate
recommendations — do not build the tab on guesswork from a single
period.

Tier Assignment

Every Active row gets assigned to exactly one tier, based on avg units
sold per SKU across the available periods (or, for a single
vendor/category grouping, the group's own avg/SKU) weighed against
months of current stock coverage (Current QOH ÷ recent-period avg annual
sold × 12):

-   KEEP (green) — avg/SKU sold is at or above the group's own median
    AND months of stock coverage is under 18. These are the winners —
    note what makes them work (format, size, theme, price point) so the
    pattern can be applied when sourcing similar items.

-   WATCH (yellow) — avg/SKU sold is positive but below median, OR SKU
    count in the group is disproportionately high relative to units sold
    (e.g. covering every size/color combination when only a few
    combinations actually move). Flag specific consolidation candidates
    by name where the data supports it — don't just say "trim."

-   PHASE OUT (red) — avg/SKU sold is at or near zero across multiple
    periods, OR months of stock coverage exceeds 24. State the specific
    driver: bloated size/color run, seasonal mismatch, vendor-level
    decline, or genuine lack of demand — these call for different fixes
    and the tab should say which.

Dead Stock Callout

Within PHASE OUT, separately call out any items with zero sales across
ALL available periods AND nonzero current stock — these are
liquidate/archive candidates, distinct from merely slow movers. List
them by name with days since last sold (or "Never Sold") and current
QOH.

Seasonal / Contextual Flags

If a subset of items shows a clear seasonal mismatch against the
report's context (e.g. winter/ski imagery sitting unsold during a
summer-show buying cycle), call this out as its own callout rather than
folding it into PHASE OUT — seasonal mismatch often means "hold for the
right season" (e.g. a register-basket plan) rather than "cut." Note the
plan if one is already known from context; otherwise just flag the
pattern.

Design/Attribute Pattern Notes

Where the data supports it, note any pattern in what distinguishes KEEP
items from PHASE OUT items within the same vendor/category — size format
(e.g. Small vs. Large), theme, price tier, or material. State the actual
numbers behind the pattern (e.g. "avg 59 units/SKU vs. 36 units/SKU")
rather than a vague impression, and note when a pattern is too small a
sample to act on alone.

Output — Recommendations Tab Layout

-   Columns: Tier | Vendor | Description | Vendor ID | Current QOH | Avg
    Sold/Yr (recent periods) | Months of Stock Coverage | Note.

-   Row 1 = title (merged). Row 2 = short italic legend explaining
    KEEP/WATCH/PHASE OUT color coding. Row 3 = bold column headers,
    frozen so they stay visible while scrolling.

-   Group by Tier (KEEP first, then WATCH, then PHASE OUT), with a bold
    section header row for each tier. Within PHASE OUT, a separate “Dead
    Stock” subsection follows the general phase-out rows.

-   Whole-row shading matches tier color: green (KEEP), yellow (WATCH),
    red (PHASE OUT/Dead Stock).

-   Close with a short “Bottom Line” row (merged, no shading)
    summarizing the overall call in one or two sentences — e.g. total
    SKU count vs. a realistic right-sized count, or a stock-coverage
    headline number.

-   Placement: last tab on both Category and Vendor reports, after
    Archived — No Sales (Ignored). Omitted entirely (not left blank)
    when there isn't enough multi-period history to support it — see the
    note above.

Purpose: this tab is Dana's starting point for feeding results into the
Future Buying Analysis workbook — she reviews it here, then says “add
this to Future Buying” to merge the findings into the running
category/vendor record. It is not a replacement for that review step.

LS Database Cleanup Project (Planning)

Long-term goal: run this flagging/size-summary process across ALL
categories in the database, then produce an "LS Update File" — a delta
file (not the full database) with columns System ID, standardized
Description, standardized Category (with size baked into the path
wherever applicable), and Vendor ID (to fix the legacy
trailing-number-in-description issue). Uploaded to LS via bulk import
matched on System ID. Target: complete before the February 2027 buying
show. LS’s native "Season" field is confirmed unusable (not editable on
the item page, only set via bulk upload, and Analytics can’t even filter
by it) — do not plan around it; rely on Category-path-based season
inference instead.

Open Questions — Revisit at Cleanup

-   Are we missing items we should be ordering — things that used to
    sell well and get reordered, but got overlooked somehow and haven’t
    actually been ordered in a couple of years? Today’s Zero Activity
    flag only catches items with BOTH zero sales AND zero stock — an
    active item that still has some stock sitting on the shelf but
    hasn’t sold in a year or two slips past every current flag. Need to
    figure out what actually signals “this used to perform and has
    quietly stalled” without flooding every day-to-day report with
    old/antiquated data in the meantime. Revisit during the October
    cleanup, not before.
