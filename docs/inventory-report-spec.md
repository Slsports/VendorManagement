# Inventory Report Formatting Spec v15 (Dana, 8/23/26)

Mirror of "8-23-26 SLS Inventory Report Formatting Spec v15.docx".


  Shaver Lake Sports Inventory Report Formatting Specification
Purpose: When a staff member uploads a raw Analytics export and says format-as-inventory-report, apply every rule in this document exactly. No guessing.
⚑  NOTE: This spec covers physical inventory count sheets only. Staff hand-writes FLOOR, BACK STOCK, BINS, and TOTAL — leave all four blank. No formulas.
  1  |  TRIGGER PHRASE
•  User uploads a raw Analytics xlsx and says "format as an inventory report" (or similar phrasing).
•  Apply this entire spec to produce the formatted xlsx output.
•  Do NOT produce a preview or ask for confirmation — just build and deliver the file.
  2  |  FILE NAMING CONVENTION
Format:   M-D-YY [NAME IN CAPS] INVENTORY.xlsx
•  Staff names raw files as:  M-D-YY [Name] Inventory.xlsx  — e.g.  8-17-26 Camping Minus Coghlan Inventory.xlsx
•  Claude reads the date from the raw file name, uppercases everything, and confirms the name ends with INVENTORY. If the raw file deviates from the convention, Claude corrects it.
•  Category or Vendor Name = derived from the employee's raw file name: strip .xlsx, strip any leading date prefix, replace ALL underscores with spaces. See §14 for full rules and examples.
•  Examples:  8-17-26 CAMPING MINUS COGHLAN INVENTORY.xlsx
–  8-17-26 FOOTWEAR INVENTORY.xlsx
–  8-17-26 MARINE INVENTORY.xlsx
–  8-17-26 CAMPING MINUS COGHLAN INVENTORY.xlsx
⚑  NOTE: No version numbers. No 'v1', no dates in the body — just as shown above.
⚑  NOTE: OUTPUT FILE NAME: Date first (from the raw file), then name in ALL CAPS, then INVENTORY. Spaces only — no underscores. If the raw file already follows the convention, Claude just uppercases it. If it deviates, Claude corrects it.
  3  |  RAW ANALYTICS FILE — SOURCE COLUMNS
The raw file from Lightspeed Analytics has exactly 7 columns:
Col
 | Raw Column Header
 | A
 | Item System ID
 | B
 | Item UPC
 | C
 | Item Default Vendor
 | D
 | Item Description
 | E
 | Item Category
 | F
 | Item Include Archived
 | G
 | Item Metrics Quantity on Hand
 | 
  4  |  DATA TRANSFORMATIONS  (do these in order)
Step 1 — DELETE the 'Item Include Archived' column entirely. Do not include it in the output.
Step 2 — RENAME columns as follows:
–  'Item System ID'  →  'SYSTEM ID'
–  'Item Default Vendor'  →  'VENDOR'
–  'Item Description'  →  'DESCRIPTION'
–  'Item Category'  →  'CATEGORY'
–  'Item Metrics Quantity on Hand'  →  'IN STOCK'
Step 3 — ADD four new blank columns after IN STOCK:
–  G = FLOOR      (blank — staff hand-writes)
–  H = BACK STOCK (blank — staff hand-writes)
–  I = BINS       (blank — staff hand-writes)
–  J = TOTAL      (blank — staff hand-writes)
Step 4 — SORT the data rows:
–  Primary sort:   Item Category  A → Z
–  Secondary sort: Item Description  A → Z  (within each category)
Step 5 — UPC FORMATTING: Store all UPC values as text to preserve leading zeros and full 12–13 digit precision.
–  If UPC is blank/missing in the raw data → leave blank in output.
⚑  NOTE: Do NOT filter rows. Include every item regardless of QoH value (zeroes and negatives stay in).
  5  |  MASTER COLUMN REFERENCE  (single source of truth — A–J)
This table is the complete spec for every column. Use it for output header names, widths, fills, alignment, and wrap — in both the header row AND data rows. Do not rely on memory; use this table.
Col
 | OUTPUT Header (use exactly)
 | Source Header (raw file)
 | Width
 | Hdr Align
 | Hdr Wrap
 | Data Align
 | Data Wrap
 | Fill (Header + Data)
 | Borders
 | A
 | SYSTEM ID
 | Item System ID
 | 15.86
 | CENTER
 | No
 | Left
 | No
 | None
 | right+bottom (hdr) right+top+bottom (data)
 | B
 | ITEM UPC
 | Item UPC
 | 14.14
 | CENTER
 | No
 | Left
 | No
 | None
 | All four sides
 | C
 | VENDOR
 | Item Default Vendor
 | 17.00
 | CENTER
 | YES
 | Left
 | YES
 | None
 | All four sides
 | D
 | DESCRIPTION
 | Item Description
 | 30.29
 | CENTER
 | YES
 | Left
 | YES
 | None
 | All four sides
 | E
 | CATEGORY
 | Item Category
 | 30.00
 | CENTER
 | No
 | Right
 | YES
 | None
 | All four sides
 | F
 | IN STOCK
 | Item Metrics QoH
 | 11.86
 | CENTER
 | YES
 | Center
 | No
 | None
 | All four sides
 | G
 | FLOOR
 | (new blank col)
 | 10.57
 | CENTER
 | No
 | Center
 | No
 | Peach FFFBE3D6 (hdr AND data)
 | All four sides
 | H
 | BACK STOCK
 | (new blank col)
 | 11.43
 | CENTER
 | YES
 | Center
 | YES
 | Lt Blue FFBDD7EE (hdr AND data)
 | All four sides
 | I
 | BINS
 | (new blank col)
 | 8.57
 | CENTER
 | No
 | Center
 | No
 | Lt Green FFDCEDD5 (hdr AND data)
 | All four sides
 | J
 | TOTAL
 | (new blank col)
 | 10.57
 | CENTER
 | No
 | Center
 | No
 | Yellow FFFFFF00 (hdr AND data)
 | left+bottom only
 | 
⚑  NOTE: ALL header cells: bold=True, font=Aptos Narrow 11pt, row height=30, ALL CAPS. ALL data cells: bold=False, font=Aptos Narrow 11pt, row height=auto. Header alignment for every column is CENTER — no exceptions.
  6  |  FILL COLOR REFERENCE  (columns G, H, I, J)
These fills apply to BOTH the header cell and every data cell in that column.
Use direct ARGB hex values only — always include the FF prefix for full opacity. Do NOT use the theme+tint method (it defaults to black and produces gray).
Col
 | Name
 | ARGB Hex (use exactly)
 | openpyxl Code  (copy exactly — FF prefix is required for full opacity)
 | G
 | FLOOR
 | FFFBE3D6
 | cell.fill = PatternFill(fill_type="solid", fgColor="FFFBE3D6")
 | H
 | BACK STOCK
 | FFBDD7EE
 | cell.fill = PatternFill(fill_type="solid", fgColor="FFBDD7EE")
 | I
 | BINS
 | FFDCEDD5
 | cell.fill = PatternFill(fill_type="solid", fgColor="FFDCEDD5")
 | J
 | TOTAL
 | FFFFFF00
 | cell.fill = PatternFill(fill_type="solid", fgColor="FFFFFF00")
 | 
⚑  NOTE: IMPORTANT: Always use the full 8-character ARGB hex (FF prefix = fully opaque). 6-character hex (no FF prefix) stores as 00 alpha = transparent = no color. Theme+tint method does NOT work reliably — use direct hex only.
from openpyxl.styles import PatternFill   # required import
  7  |  FONT
•  Font: Aptos Narrow  (NOT Tahoma — that rule applies to Word docs only)
•  Size: 11pt  (all cells, header and data)
•  Bold: NO for data rows.  BOLD: YES for header row (Row 1) only.
•  Italic: NO
  8  |  EXCEL TABLE
•  Format all data as an Excel Table.
•  Table name: Table1
•  Style: TableStyleLight15  (built-in Excel style)
•  Row Stripes: ENABLED  (showRowStripes=True)
•  Column Stripes: OFF
•  Auto-filter: enabled on all columns
•  Table range: A1 : J[last data row]
  9  |  HEADER ROW  (Row 1)
•  Row height: 30 pt
•  Font: Aptos Narrow, 11pt, BOLD
•  Border on ALL header cells: thin (automatic gray)
Per-column details:
–  A — no fill | CENTER align | no wrap | borders: right + bottom (no left, no top)
–  B — no fill | CENTER align | no wrap | borders: left + right + bottom
–  C — no fill | LEFT align | WRAP TEXT ON | borders: left + right + bottom
–  D — no fill | CENTER align | WRAP TEXT ON | borders: left + right + bottom
–  E — no fill | CENTER align | no wrap | borders: left + right + bottom
–  F — no fill | CENTER align | WRAP TEXT ON | borders: left + right + bottom
–  G — Light Peach fill (§6) | CENTER align | no wrap | borders: left + right + bottom
–  H — Lt Blue fill (§6)  | CENTER align | WRAP TEXT ON | borders: left + right + bottom
–  I — Lt Green fill (§6) | CENTER align | no wrap | borders: left + right + bottom
–  J — Yellow fill (§6)   | CENTER align | no wrap | borders: left + bottom ONLY (no right border)
  10  |  DATA ROWS  (Row 2 → last row)
•  Font: Aptos Narrow, 11pt, not bold
•  Row height: default (auto-height)
Per-column details:
–  A — no fill | left align | no wrap | borders: right + top + bottom (no left)
–  B — no fill | left align | no wrap | borders: all four sides
–  C — no fill | LEFT align | WRAP TEXT ON | borders: all four sides
–  D — no fill | left align | WRAP TEXT ON | borders: all four sides
–  E — no fill | RIGHT align | WRAP TEXT ON | borders: all four sides
–  F — IN STOCK: no fill | CENTER align | no wrap | borders: all four sides. NOTE: if In Stock value is negative (LS data error), treat as 0 for any Need calculations — negative stock counts as 0.
–  G — Light Peach fill (§6) | CENTER align | no wrap | borders: all four sides
–  H — Lt Blue fill (§6)  | CENTER align | WRAP TEXT ON | borders: all four sides
–  I — Lt Green fill (§6) | CENTER align | no wrap | borders: all four sides
–  J — Yellow fill (§6)   | CENTER align | no wrap | borders: left + top + bottom (no right)
⚑  NOTE: Columns G, H, I, J carry the same fill color in every row (header AND all data rows). The fill does not alternate — it is solid throughout.
  11  |  PAGE SETUP
•  Orientation: LANDSCAPE
•  Fit to width: 1 page wide × unlimited pages tall (all 10 columns print on one page width)
–  openpyxl:  ws.page_setup.fitToWidth = 1   |   ws.page_setup.fitToHeight = 0
–             ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
•  Scale: 79 (set on pageSetup even when fit-to-width is active)
•  Paper: Letter (default — do not set paper size)
Margins (inches):
–  Left = 0.25  |  Right = 0.25  |  Top = 0.75  |  Bottom = 0.75
–  Header = 0.30  |  Footer = 0.30
openpyxl margin code:
ws.page_margins = PageMargins(left=0.25, right=0.25, top=0.75, bottom=0.75, header=0.3, footer=0.3)
  12  |  PRINT TITLES  (Header Repeat)
•  Row 1 must repeat on every printed page.
ws.print_title_rows = '$1:$1'
  13  |  PAGE HEADER / FOOTER
Excel custom headers have THREE separate sections. Each MUST be set as its own separate line of code. NEVER combine them.
⚑  NOTE: CRITICAL: Every header section MUST start with '&amp;16' to set 16pt font size. Missing &amp;16 produces tiny default-size text.
Section
 | Content
 | EXACT openpyxl code — each on its own separate line
 | Left
 | Date (16pt)
 | ws.oddHeader.left.text = "&amp;16&amp;D"
 | Center
 | Name — cleaned &amp; uppercase (see rules below)
 | ws.oddHeader.center.text = "&amp;16" + header_center_name
 | Right
 | Page X of Y, 16pt
 | ws.oddHeader.right.text = "&amp;16Page &amp;P of &amp;N"
 | 
Rules for building header_center_name from the raw input file name:
–  1. Strip the .xlsx extension
–  2. Strip any leading date prefix  (e.g. '8-17-26_' or '8-17-26 ' at the start)
–  3a. Remove ALL instances of the words 'INVENTORY', 'Inventory', 'REPORT', or 'Report' from the name — the header only needs the category/vendor name
–  3. Replace ALL underscores with spaces
–  4. Trim any leading or trailing whitespace
–  5. Convert to UPPERCASE
Full working example:
# Raw input file: "8-17-26 Camping Minus Coghlan Inventory.xlsx"
header_center_name = "CAMPING MINUS COGHLAN"   # date and INVENTORY stripped  # strip date + "INVENTORY", uppercase
ws.oddHeader.left.text   = "&amp;16&amp;D"
ws.oddHeader.center.text = "&amp;16" + header_center_name   # → "&amp;16CAMPING MINUS COGHLAN"
ws.oddHeader.right.text  = "&amp;16Page &amp;P of &amp;N"
⚑  NOTE: CRITICAL: Set each section as its OWN separate line. NEVER use a single raw string with &amp;L, &amp;C, &amp;R codes — this breaks the header and produces garbage output.
  14  |  CATEGORY / VENDOR NAME — USE THE RAW FILE NAME
Staff names raw files as:  M-D-YY [Name] Inventory.xlsx  Claude reads the date, uppercases the name, and outputs:  M-D-YY [NAME] INVENTORY.xlsx  If the raw file deviates, Claude corrects it without asking.
Raw Input File Name
 | Output File Name
 | Page Header Center
 | 8-17-26 Camping Inventory.xlsx
 | 8-17-26 CAMPING INVENTORY.xlsx
 | CAMPING
 | 8-17-26 Camping Minus Coghlan Inventory.xlsx
 | 8-17-26 CAMPING MINUS COGHLAN INVENTORY.xlsx
 | CAMPING MINUS COGHLAN
 | 8-17-26_CAMPING_MINUS_COGHLAN.xlsx  ← deviates: fix it
 | 8-17-26 CAMPING MINUS COGHLAN INVENTORY.xlsx
 | CAMPING MINUS COGHLAN
 | 8-17-26 Footwear Inventory.xlsx
 | 8-17-26 FOOTWEAR INVENTORY.xlsx
 | FOOTWEAR
 | 8-17-26 Marine - New Arrivals Inventory.xlsx
 | 8-17-26 MARINE - NEW ARRIVALS INVENTORY.xlsx
 | MARINE - NEW ARRIVALS
 | 
Output file name rules:
–  1. Strip .xlsx extension
–  2. Extract the date prefix (M-D-YY format); if missing from file name, use today's date
–  3. Remove the date prefix from the name portion
–  4. Remove ALL instances of the words 'INVENTORY', 'Inventory', 'REPORT', or 'Report' from the name portion (wherever they appear)  — do not add 'Report' back in at any point
–  5. Replace underscores with spaces; trim whitespace
–  6. Convert name to ALL CAPS
–  7. Reconstruct: [DATE] [CLEANED NAME] INVENTORY.xlsx  ← exactly one INVENTORY, always at the end
⚑  NOTE: IMPORTANT: Always strip 'Inventory' from the name portion BEFORE appending it — this prevents doubling when the raw file already contains the word.
⚑  NOTE: Never ask the employee what to name the file. The answer is always in the file name they uploaded.
  15  |  DELIVERY
•  Save as .xlsx.
•  Name per §2 convention (e.g., "8-17-26 CAMPING MINUS COGHLAN INVENTORY.xlsx") — ALL CAPS, date first, ends with INVENTORY.
•  Use present_files to deliver — the formatted file must be downloadable.
•  No summary, no preview — just deliver the file.
Redelivery versioning — check this every time, not just when reminded. Before sending any file, ask: has this exact report already been delivered once in this session (even if the request that triggered the redelivery was unrelated — a correction, a new instruction, a follow-up tweak)? If yes, append ‘ v2’, ‘ v3’, etc. to the end of the file name (before the extension). The first delivery of a given report stays unversioned; every delivery after that is versioned, with no exceptions and without being asked. Do not rely on the person to notice and remind you — confirm this before every file is handed off.
  Shaver Lake Sports (SLS) — Internal Use Only | Inventory Report Spec | No version tracking required
