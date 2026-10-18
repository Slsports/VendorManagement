# Item naming, do-not-reorder and discontinued items — summary for the Fable session (Oct 18, 2026)

Written by the Opus session for Dana, so both sessions start from the same place. Dana will decide who builds what.
Nothing below is built yet unless it says so. Dana's decisions are also in `docs/decisions.md` (Oct 18 entries).

## Read first
- `docs/sop/SOP-INV-001-NC_Item_Naming_Conventions.md` (the .docx next to it is the original Trevor sent).
- `docs/sop/item-naming-vms-proposals.md`: Trevor's three proposals (1 name suggestions on orders, 2 vendor record
  additions, 3 Lightspeed integration: markers, rename on reorder, price-change and shelf-tag tasks, batch cleanup).
  Trevor asks that the three be approved together. **Dana has not approved them yet.**
- The CLAUDE.md rules added Oct 17: go by the labels people see on the other system's screen; list "their label → VMS"
  before an import writes; never say something doesn't exist until every source is checked.

## Facts checked against live data (Oct 18)
- 16,725 active LS items (`ls_items`, copied by `ls-sync`). By the SOP: 1,815 names over 52 characters, 2,679 use
  replaced words (YOUTH, GREY, XXL, L/S, SHAVER LAKE, WITH…), 522 have commas, curly quotes or ™/®, 294 are not all caps,
  57 have #, 4,398 have no Vendor ID in LS.
- LS has no brand in our copy; many names have no brand at the start ("LADIES SWIMSUIT S"), so brand fixes need the tag.
- LS item **Notes** are readable through the API (`load_relations=["Note"]`, fields `note`, `isPublic`). Dana: public =
  prints on the customer's sales receipt; private = internal. Not yet copied into VMS.
- Do-not-reorder markers today: 37 active items start with * (34 have a note), 90 start with ** (7 have a note).
- Becker (LS vendor 265) shows how notes are written now: "REPLACED WITH 63360" (names the new Vendor ID),
  "Replaced with new styles", "Will replace with something out of the G & S Catalog through Sonny", "11/2025 -
  Discontinued - no replacement", ordering instructions ("To order Assorted … use #71235"), one item with its * at the
  END of the name ("…63377 LARGE *"), and a * item with no note.
- VMS's LS connection: `lightspeed_connections.scope` is empty, so the access level is not confirmed. Writing to LS
  (markers, notes, new items) needs Dana to reconnect with **Full** access (Settings › Lightspeed).
- Vendor "Add Vendor ID to item names" setting (`vendors.vid_in_description`, plus per order and per line) is on only for
  COGHLAN. The SOP list is Coghlans, World Famous Sports, Lazy One, Ty, plus every Fishing-category item.

## Dana's decisions (Oct 18)
1. The "Add Vendor ID" setting stays (a few vendors need it); names leave the Vendor ID off otherwise.
2. Item Notes should show in VMS.
3. Discontinued items only matter **when running sales reports to decide what to order** and **from ordering to the
   vendor's confirmation**. After the order is placed they are no longer needed (so not on check-in or the vendor page).
4. Sales reports: discontinued items clearly visible; when a replacement is noted, the replacement shows as an item to
   order.
5. Final confirmation: the summary says "X was discontinued, replaced with Y".
6. When a vendor's confirmation says items are unavailable or replaced, Claude records it; what Claude can't settle goes
   to the Review tab of whoever placed the order.
7. **Decisions are made in the Review tab and VMS writes them to LS** ("Staff should not have to go in to ls
   separately"). This changes the SOP line "VMS never adds, removes, or changes a marker" — Trevor to update the SOP.
8. Review buttons for an unavailable item:
   - **Use replacement**: * at the start of the old item's name in LS + internal note "REPLACED WITH <Vendor ID>"; the new
     item goes on the order.
   - **Discontinued, no replacement**: * + note.
   - **Out of stock**: no marker; an internal note in LS like "OUT OF STOCK AT VENDOR 10/18/26", **with the vendor's
     back-in-stock date when given** ("…, BACK 11/15/26"); Claude fills the date from the confirmation, the card has a
     box to add or fix it; the next sales report shows it.
   - **DNR (do not reorder)** for bad quality or poor sellers: ** + note with the reason. **Only Dana, Trevor and Jarrett
     can choose DNR**; anyone else gets "Send a message about DNR to Dana, Trevor or Jarrett".
   - Notes are added to whatever note is already there, never replacing it.

## Still open (Dana)
- Keep a "Leave as is" button (for when Claude misread the confirmation) or drop it?
- Should ** items show on sales reports the same way as *?
- Who builds which part (below).
- Approval of Trevor's three proposals; for Proposal 3: which stores get shelf-tag tasks (Trevor named Shaver Lake
  Marina and The Happy Camper; Shaver Lake Sports is also an LS store), who gets price-change tasks per store, and whether
  web search as a last resort is OK.
- Full access reconnect to LS.

## Pieces of work and where they touch
| Piece | Touches |
|---|---|
| Copy item Notes into `ls_items` (`note`, `note_public`) | `ls-sync` (Fable's): add "Note" to the Item `load_relations` and two fields in `itemRow`; a migration for the columns |
| Discontinued / DNR / out-of-stock / replacement on sales reports | Fable's sales report (spec v49, `src/lib/salesReport.ts`, `src/services/lsReports.ts`) |
| Unavailable items from vendor confirmations, Review cards, final confirmation summary | Opus's order checks (`order-check`, `OrderCheckPage`, `finalOrder.ts`) |
| Writing * / ** and notes to LS from Review | `lightspeed` function; needs Full access |
| SOP check, batch cleanup, name suggestions, Item Name Memory, shelf-tag tasks (Trevor's proposals) | new; waits on approval |

## Work in progress in the Opus session (not committed)
The Opus session started the Notes copy (migration `…160_ls_item_notes.sql` adding `ls_items.note` and
`ls_items.note_public`, the `ls-sync` change above, and a marker/notes helper) and set it aside when Dana's plan changed.
It is not on the branch. Whoever builds the Notes copy should check with Dana first so it is done once.

Also: the Opus session's weekly LS item reading (`lightspeed` function, `scan_items`, for the vendor Active / Inactive
in LS labels) reads all items, which `ls-sync`'s six-hourly full pass already does. They could share one reading later.
