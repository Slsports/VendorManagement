-- 0237 — Planet Cotton's design goes with the garments above it (Dana, Oct 24, invoice 164402): "Even if there are several
-- groups of different shirts, they always go with the design below them. So both pt100 and pt100v are design R5388-2-L,
-- the same as PS 100H. This is very common so make a rule. We also do not use vendor id in the description for planet
-- orders." (vid_in_description is already off for Planet Cotton, so new LS names never carry the Vendor ID.)

set local lock_timeout = '5s';

update public.vendors
   set vendor_id_rule = 'Garment # / design #, like PT 6934/R6886. The garment # is in the Item column (Item Code). The design # is on its own DESIGN: line (e.g. "DESIGN: R6886: Shaver Lake Mountains FF"). Every garment line goes with the first DESIGN line below it, even when several groups of different garments come before that DESIGN line (PT 100, PT 100V and PS 100H above "DESIGN: R5388-2-L" are all R5388-2-L). Garment lines after the last DESIGN line on a page go with the next DESIGN line below them, even on the next page. One paper can have several garments and several designs. Keep the DESIGN, tags and other charge lines as their own lines, as printed. Do not use the Style column as the garment #.',
       vid_in_description = false
 where id = '8ddde2cd-7328-45b6-8219-b10a8bf97587';
