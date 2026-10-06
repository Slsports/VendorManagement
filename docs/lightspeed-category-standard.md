# Lightspeed Category Standard

Draft for sign-off by Dana Powell and Trevor. Written 2026-10-06 from the Oct 5 Lightspeed exports
(16,771 items, 1,017 categories). The reviewed copy lives in the Claude Doc "Lightspeed Category
Standard"; this file mirrors it so the clean-up tooling has the rules next to the code. When the two
differ, the signed-off doc wins and this file is updated to match.

## 1. Why one standard

Sizes in the category tree are what make reordering easy: a sales report by category shows which
sizes sold, so the reorder writes itself. That only works when every branch is built the same way and
every size is spelled the same way.

This is the standard for every category in Lightspeed from here on. The clean-up pass applies it to
the roughly 13,000 active items once; after that, new items follow it. Nothing in Lightspeed changes
until VMS is connected to it and each batch of changes is approved.

## 2. The ladder

Every sized category is built on the same five rungs, in the same order:

```
1 DEPARTMENT   CLOTHING, FOOTWEAR, CAMPING, WINTERSPORTS, PET ACCESSORIES ...
2 TYPE         SWIMWEAR, PAJAMAS, SOCKS, T-SHIRTS, SLIPPERS, TENTS, COOLERS ...
3 AGE          INFANT, TODDLER, KIDS, YOUTH, ADULT
4 GENDER       MENS, WOMENS, BOYS, GIRLS, UNISEX
5 SIZE         XS, SM, MED, LG, XL, 2XL, 3XL, 4XL, or months, T sizes, shoe sizes
```

Three paths built the same way:

- `CLOTHING > SWIMWEAR > KIDS > GIRLS > MED (10/12)`
- `CLOTHING > SOCKS > ADULT > MENS > LG`
- `CLOTHING > PAJAMAS > ADULT > UNISEX > XL`

Rules:

- An item sits on the deepest rung its branch has. Never on AGE or GENDER when a SIZE rung exists
  below. Nothing stops at AGE.
- Nothing with an age or gender stops before SIZE: a one-size item takes a `ONE SIZE` rung. Things
  with no age or gender (tents, coolers) stop at TYPE and take their own size rung (section 5).
- Footwear uses the same ladder with shoe sizes on the SIZE rung: `HIKING > ADULT > WOMENS > 8.5`
  (section 5).

**Rung 1, Department.** The 22 live departments stay as they are. No new departments in this pass.

**Rung 2, Type.** The kind of thing. A type may have one sub-type rung when the shop really sells them
apart (`SWIMWEAR > RASH GUARDS`, `SWEATSHIRTS > HOODIE`, `SOCKS > SKI`). Sub-types sit between Type
and Age; they never carry age or gender words.

**Rung 3, Age.** Exactly one of five words:

| Word | Covers |
|---|---|
| INFANT | 0 to 24 months (sizes in months) |
| TODDLER | 2T to 5T |
| KIDS | roughly 4 to 7 (XS to LG with the number guide) |
| YOUTH | roughly 8 to 16 (SM to XL with the number guide) |
| ADULT | everything else |

JUNIORS is retired as an age word; those items become YOUTH (open point 8.4). Where a vendor sizes
KIDS and YOUTH as one run (World Famous Sports does), the branch keeps one rung named KIDS with the
vendor's full run under it.

**Rung 4, Gender.** Exactly one of MENS, WOMENS, BOYS, GIRLS, UNISEX. Under ADULT the pair is MENS
and WOMENS; under KIDS and YOUTH it is BOYS and GIRLS; UNISEX is allowed under any age. Age and
gender are two rungs, so the picker reads `KIDS > GIRLS`, not `KIDS GIRLS`, and `ADULT > UNISEX`,
not `ADULT UNISEX`. Decided Oct 6 (Dana): UNISEX is a gender, so `SWEATSHIRTS > ADULT > UNISEX`,
`KIDS > UNISEX`, `YOUTH > UNISEX`.

**Rung 5, Size.** The size names in section 3. Infant and toddler branches use months and T sizes.

## 3. Size names

One spelling per size, everywhere. The export shows nine spellings in use today (SMALL/MEDIUM/LARGE
on 75 branches, SM/MD/LG on 9, XS to XL on 56, ranges like "SIZE 10-12" on 57, and more). The
clean-up renames all of them to this list.

**Letter sizes (adult, youth, kids).**

| Standard | Replaces | Notes |
|---|---|---|
| XS | X-SMALL, XSMALL | |
| SM | SMALL, S | |
| MED | MEDIUM, MD, M | MED, never MD |
| LG | LARGE, L | |
| XL | X-LARGE, XLARGE, 1XL | 1XL on bibs becomes XL |
| 2XL | XXL, 2X, XX-LARGE | number first, then XL |
| 3XL | XXXL, 3X | |
| 4XL | 4X | |

**Size guides in parentheses.** Where staff need the number run to file an item, the guide follows the
letter in parentheses, with a slash for a two-number size and a dash for a range: `MED (10/12)`,
`LG (12-14)`, `XL (18-20)`. The letter always comes first so the picker sorts the same way in every
branch. The old `4-5 SM`, `6-6X MED`, `7 LG` on winter bibs become `SM (4-5)`, `MED (6-6X)`, `LG (7)`.

**Vendor-mirrored runs.** Where a branch mirrors a vendor's size run (World Famous Sports swimwear
and rash guards), the vendor's numbers stay as the guide: `SM (4/5)`, `MED (6/7)`, `LG (8/10)`,
`XL (12/14)`, `2XL (16/18)`. The guide is the vendor's; the letter is ours.

**Infant.** Months with the M suffix and no space: `0-3M`, `3-6M`, `6M`, `6-12M`, `12M`, `18M`,
`24M`. A vendor that sizes 0-24 months as one run keeps that run.

**Toddler.** `2T`, `3T`, `4T`, `5T`. A two-size item joins them with a slash, `5/6T`.

**One size.** Items made in one size take a size rung spelled `ONE SIZE` (decided Oct 6; never `OS`,
`OSFA` or `O/S`): `SWEATSHIRTS > ADULT > WOMENS > ONE SIZE`, `HATS > BEANIES > ADULT > UNISEX > ONE SIZE`.
That way every item in a sized branch sits on the size rung and the reorder report has no gaps.

**Order in the picker.** Lightspeed sorts categories alphabetically, so sizes do not line up small to
large on their own. Accept that; the names are what matter for reorder reports.

## 4. Spelling and characters

These rules exist because the export mangles some characters and because a reorder report groups by
exact name. Two spellings of the same thing are two categories to Lightspeed.

- **All caps.** Every category name, every rung.
- **Straight apostrophe only.** The curly kind is what turns into `%` and `â€™` in exports. The
  standard avoids the question by writing `MENS`, `WOMENS`, `BOYS`, `GIRLS` with no apostrophe.
- **No inch or foot marks.** Write `IN` and `FT`: `6 FT BEACH`, `10X10`, `12 IN`.
- **Slashes and dashes are safe.** Slash between two sizes on one item (`MED (10/12)`, `5/6T`), dash
  for a range (`LG (12-14)`, `20-39 QT`).
- **Ampersand is safe.** `TOYS & GAMES`, `BIB & JACKET SETS` stay.
- **No commas inside a name.** `GOGGLES, MASKS & FINS` becomes `GOGGLES MASKS & FINS`.
- **No trailing spaces, no double spaces.**
- **Numbers before letters in a size.** `2XL`, never `XXL`.
- **No two categories differ only by case, spacing or punctuation.** The clean-up merges any such pair.
- **Shortened but still understandable.** `MED` not `MEDIUM`, `LG` not `LARGE`; `SZ` is not used in
  a size guide (the parentheses already say it is a size).

Abbreviations the standard keeps: `LS` (long sleeve), `SS` (short sleeve), `QT`, `IN`, `FT`, `M`
(months, on infant sizes), `T` (toddler sizes), `PFD` (life jackets). Anything else is spelled out.

## 5. Sizes outside clothing

No age or gender rung; the size rung sits right under the type (or sub-type).

**Tents** (`CAMPING > TENTS`, 28 items with no breakdown). By how many it sleeps: `1-2 PERSON`,
`3-4 PERSON`, `5-6 PERSON`, `8+ PERSON`, plus `TENT ACCESSORIES` (footprints, stakes, poles, repair).

**Coolers** (`CAMPING > COOLERS`, 20 items):

| Path | Covers |
|---|---|
| COOLERS > HARD > UNDER 20 QT | |
| COOLERS > HARD > 20-39 QT | |
| COOLERS > HARD > 40-69 QT | |
| COOLERS > HARD > 70+ QT | |
| COOLERS > SOFT > BAGS > UNDER 16 CAN | |
| COOLERS > SOFT > BAGS > 16-30 CAN | |
| COOLERS > SOFT > BAGS > 30+ CAN | |
| COOLERS > SOFT > BACKPACK | all backpack coolers, any size |
| COOLERS > ACCESSORIES | ice packs, baskets, dividers |

A cooler sold by liters is filed by the nearest quart band.

**Canopies and shelters** (new type under CAMPING). `CANOPIES > 10X10`, `CANOPIES > 12X12`,
`CANOPIES > OTHER`, plus `SHELTERS` for screen rooms and sun shelters. No feet marks.

**Umbrellas.** `UMBRELLAS > RAIN`, `UMBRELLAS > CHAIR` (clip-on), `UMBRELLAS > BEACH` (the 6 FT ones).

**Sleeping bags** (21 items). Proposed `ADULT` and `KIDS` only, no temperature bands (open point 8.3).

**Pet items** (collars 130, harnesses 41, life jackets 25, clothing 20). Letter sizes `XS` to `XL`
under each type: `PET COLLARS > MED`. No age or gender rung.

**Life jackets** (`WATERSPORTS > LIFE JACKETS`). Keep the weight bands the label prints. Spelling
only: `INFANT UNDER 30 LB`, `CHILD 30-55 LB`, `YOUTH 50-90 LB`, `TEEN OR ADULT PETITE 75-125 LB`,
`ADULT SM-MED 90+ LB`, `ADULT LG-XL`, `ADULT 2X-6X`. `LB` not `LBS`, a dash for the range.

**Helmets and goggles.** Helmets by `ADULT` or `YOUTH` then `SM`, `MED`, `LG`, `XL`; the existing
`ADULT > ADULT MED` becomes `ADULT > MED`. Goggles by `ADULT` or `KIDS` only.

**Footwear** (decided Oct 6: full clean-up with shoe sizes). Same ladder as clothing, with the shoe
size on the last rung: `FOOTWEAR > HIKING > ADULT > WOMENS > 8.5`. The types stay as they are
(HIKING, BOOTS - WINTER, BOOTS - WORK, SLIPPERS, FLIP FLOPS, WATER SHOES). Sizes are written as the
box prints them: `8`, `8.5`, `10`, no `SZ` and no `US`. The age rung keeps its shoe-size guide so
staff know where a run breaks: `INFANT (1-7)`, `KIDS (8-12)`, `YOUTH (13-6)`; under those the sizes
are the run's own numbers (youth `13`, `1`, `2` to `6`). Widths (`W`, `WIDE`) stay in the item
name. Flip flops and slippers sold as S/M/L take the letter sizes from section 3. Lightspeed sorts
the size rung alphabetically, so `10` lists before `8`; a leading zero (`08`, `08.5`) would fix the
order at the cost of looking odd. Default: plain numbers.

**No size rung, ever.** Stickers (the `LG` in a sticker name is the design), fishing line and leaders
(test weight stays in the item name), rope and cord, chargers, nets, insoles. Flagged by the analysis
because their names carry size words; left alone.

## 6. Worked examples

| Today | Under the standard |
|---|---|
| CLOTHING > T-SHIRTS > LARGE | CLOTHING > T-SHIRTS > ADULT > UNISEX > LG |
| CLOTHING > T-SHIRTS > KIDS > 5/6T | CLOTHING > T-SHIRTS > TODDLER > UNISEX > 5/6T |
| CLOTHING > T-SHIRTS > KIDS > 12M | CLOTHING > T-SHIRTS > INFANT > UNISEX > 12M |
| CLOTHING > T-SHIRTS (257 items on the type) | one of the paths above, by the size in the item name |
| CLOTHING > SWEATSHIRTS > HOODIE UNISEX > MEDIUM | CLOTHING > SWEATSHIRTS > HOODIE > ADULT > UNISEX > MED |
| CLOTHING > TANK TOPS > WOMENS > RACERBACK > M | CLOTHING > TANK TOPS > RACERBACK > ADULT > WOMENS > MED |
| CLOTHING > SWIMWEAR > WOMENS > BIKINI > MEDIUM  (8-10) | CLOTHING > SWIMWEAR > BIKINI > ADULT > WOMENS > MED (8-10) |
| CLOTHING > SWIMWEAR > JUNIORS > GIRLS > BIKINI > SMALL | CLOTHING > SWIMWEAR > BIKINI > YOUTH > GIRLS > SM |
| CLOTHING > SWIMWEAR > KIDS > BOYS > 10-Aug | CLOTHING > SWIMWEAR > KIDS > BOYS > MED (8-10) |
| CLOTHING > SWIMWEAR > RASH GUARDS > BOYS (55 items, no sizes) | CLOTHING > SWIMWEAR > RASH GUARDS > KIDS > BOYS > SM (4/5) ... |
| CLOTHING > WINTER CLOTHING > BIBS > KIDS > 6-6X MED | CLOTHING > WINTER CLOTHING > BIBS > KIDS > UNISEX > MED (6-6X) |
| CLOTHING > WINTER CLOTHING > BIBS > WOMENS > 1XL | CLOTHING > WINTER CLOTHING > BIBS > ADULT > WOMENS > XL |
| CLOTHING > PAJAMAS (311 items) | CLOTHING > PAJAMAS > ADULT > UNISEX > MED, or KIDS > BOYS > SM (4-5) |
| CLOTHING > SOCKS (142 items) | CLOTHING > SOCKS > ADULT > MENS > LG; CLOTHING > SOCKS > SKI > ADULT > WOMENS > MED |
| CLOTHING > UNDERWEAR > MENS (140 items) | CLOTHING > UNDERWEAR > ADULT > MENS > MED |
| CLOTHING > LONG SLEEVE > PERFORMANCE LS > MENS > MD | CLOTHING > LONG SLEEVE > PERFORMANCE LS > ADULT > MENS > MED |
| WINTERSPORTS > HELMETS > ADULT > ADULT MED | WINTERSPORTS > HELMETS > ADULT > MED |
| WINTERSPORTS > HELMETS > YOUTH > YOUTH SMALL | WINTERSPORTS > HELMETS > YOUTH > SM |
| FOOTWEAR > BOOTS - WINTER > YOUTH (SZ 13-6) > BOYS | FOOTWEAR > BOOTS - WINTER > YOUTH (13-6) > BOYS > 3 |
| FOOTWEAR > FLIP FLOPS > KIDS BOYS | FOOTWEAR > FLIP FLOPS > KIDS > BOYS |
| CAMPING > TENTS > 4 MAN | CAMPING > TENTS > 3-4 PERSON |
| CAMPING > COOLERS > COOLER BAGS | CAMPING > COOLERS > SOFT > BAGS > 16-30 CAN (by the bag) |
| CAMPING > COOLERS > BACKPACK COOLERS | CAMPING > COOLERS > SOFT > BACKPACK |
| WATERSPORTS > GOGGLES, MASKS & FINS > MASKS | WATERSPORTS > GOGGLES MASKS & FINS > MASKS |
| CLOTHING > HATS > BEANIES (34 one-size items on the type) | CLOTHING > HATS > BEANIES > ADULT > UNISEX > ONE SIZE |

`10-Aug` and `14-Dec` are Excel's doing (`8-10` and `12-14` read as dates). Both get renamed, letter
first (open point 8.7). Where a sub-type exists (HOODIE, RACERBACK, BIKINI, RASH GUARDS, SKI) it sits
right under the type and before the age rung (open point 8.5).

## 7. What the first pass covers

About 4,200 of the 16,771 items, in four kinds of change.

**A. Clothing branches with no size rung yet** (about 1,900 items). New rungs get built, then the
items move down by the size in their name: PAJAMAS 311; SOCKS 142 plus SKI 31 and WORK 21;
UNDERWEAR MENS 140, WOMENS 31, KIDS 8; SHIRTS 84; ONESIES 81; SHORTS WOMENS 81, MENS 26, YOUTH BOYS
12, GIRLS 8; SWEATSHIRTS 67 plus WOMENS 25 and CREW NECK 11; RASH GUARDS 59, BOYS 55, WOMENS 28,
GIRLS 27, JUNIORS 21, MENS 14; GLOVES WINTER MENS 56, WOMENS 18, TODDLER-INFANT 12, BOYS 9, KIDS 8,
GIRLS 7; TANK TOPS 50; SWEAT SET 48; SWEATPANTS 32; LEGGINGS 28; THERMALS 105 across MENS, WOMENS
and YOUTH; FACE and GAITORS 33; VESTS 31; HATS KIDS-INFANTS 20; HUNTING CLOTHING and RAIN SUITS 25.

**B. Items sitting above a size breakdown that already exists** (about 1,500 items). No new rungs;
each item moves down to the size its name says: T-SHIRTS 257; LONG SLEEVE 122; HOODIE UNISEX 98;
SWIMWEAR KIDS GIRLS 96; RACERBACK 79; T-SHIRTS KIDS 78; SWEATSHIRTS 67; TANK TOPS 50 plus WOMENS 29;
SWIMWEAR KIDS BOYS 45; BEANIES 34; WINTER JACKETS MENS 21 and WOMENS 17; HOODIE ZIP 16; HELMETS 56,
TENTS 28, VESTS 13.

**C. Footwear and gear** (about 600 items). Footwear gets the full ladder with shoe sizes: slippers
152, flip flops 75, winter boots 37 (the youth, kids and infant branches that have gender but no
sizes), work boots 17, hiking 12. Gear: helmets 56, goggles 47, tents 28, sleeping bags 21, coolers
20; pet collars 130, harnesses 41, pet life jackets 25, pet clothing 20.

**D. Renames only, no item moves.** 75 branches spelled SMALL/MEDIUM/LARGE and 9 spelled SM/MD/LG
become SM/MED/LG; `ADULT > ADULT MED` becomes `ADULT > MED`; `1XL` becomes `XL`; `10-Aug` and
`14-Dec` get their real sizes back; `GOGGLES, MASKS & FINS` loses its comma; `KIDS BOYS` and
`KIDS GIRLS` under flip flops become two rungs.

**Left alone on purpose.** Stickers 356, fishing line 66 and fly line 20, rope 37, chargers 46, nets
20, insoles 6, shoe chains 25. Sunglasses (256 items sitting on the department) are a filing job for
the second pass.

**Second pass, after Lightspeed is connected.** Item names checked against the category they sit in,
the 18 empty departments reviewed, archived items left where they are.

## 8. Open points to sign off

Each has a default. Signing off with no change means the default stands.

1. **ADULT UNISEX wording.** Decided Oct 6 (Dana): UNISEX is a gender, so two rungs everywhere:
   `SWEATSHIRTS > ADULT > UNISEX`, `KIDS > UNISEX`, `YOUTH > UNISEX`. One-size items take a
   `ONE SIZE` rung below that.
2. **Footwear sizes.** Decided Oct 6: full clean-up with shoe-size rungs,
   `HIKING > ADULT > WOMENS > 8.5` (section 5). Still open inside it: plain numbers (default) or a
   leading zero so the picker sorts 8 before 10.
3. **Sleeping bags.** Default: `ADULT` and `KIDS` only. Alternative: temperature bands.
4. **JUNIORS.** Default: retire it; those items become YOUTH.
5. **Where a sub-type sits.** Default: before age (`SWIMWEAR > BIKINI > ADULT > WOMENS > size`),
   matching RASH GUARDS and PERFORMANCE LS. Alternative: after gender, the way women's swimwear is
   built today.
6. **Misfiled items.** Decided Oct 6: yes. When the name says one size and the item sits in another,
   the clean-up moves it and lists the move on the proposal sheet.
7. **The two date names.** Decided Oct 6: `10-Aug` becomes `MED (8-10)`, `14-Dec` becomes
   `LG (12-14)`; the letters get checked against the vendor's run when the proposal sheet is built.
8. **World Famous Sports runs.** Default: the WFS guide (`SM (4/5)`, `MED (6/7)`, `LG (8/10)`,
   `XL (12/14)`, `2XL (16/18)`) applies under every KIDS and YOUTH branch, so one guide serves all
   vendors.
9. **Helmets and goggles.** Default: as written in section 5.
10. **What Trevor already built.** Anything restructured in the live tree since the Oct 5 export is
    kept where it fits this standard, and this standard is updated where it does not.

## 9. How the changes reach Lightspeed

1. **Sign-off.** Dana and Trevor settle the open points; this standard is corrected to match.
2. **Proposal sheet.** VMS produces one spreadsheet from the latest export: new categories (full
   path), renames (old, new, item count), item moves (item, Vendor ID, today's category, proposed
   category, the size word that decided it). Rows can be struck out before anything runs.
3. **Batch approval, assigned by department.** Changes go in by branch. Each batch is assigned to an
   employee by a rule kept in VMS Settings > Review assignments (everything under FISHING to Jarrett,
   for example; Dana as the fallback). The assignee works the batch and an admin approves it. The same
   rules route today's review queue and the mismatches the second pass finds.
4. **Write-back.** Once VMS is connected to the Lightspeed API, an approved batch creates categories,
   renames, then moves items. Each change is logged with who approved it and when.
5. **Reversible.** Every batch keeps its before state and can be undone from the log as one action.
6. **Keeping it clean.** New items that land above the size rung, or in a category spelled outside
   this standard, show up on a VMS review list for the buyer who entered them.

Until the connection exists, the proposal sheet is the work list for anyone making changes by hand,
and VMS can re-run it against a fresh export to show what is left.
