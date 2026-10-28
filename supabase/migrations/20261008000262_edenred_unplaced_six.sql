-- 0262 — The six Edenred files VMS couldn't place (Dana, Oct 28). Read: four are XPO freight through WWD, one Mechanix
-- Wear, one Strike King (neither is one of our vendors; Dana doesn't recognize them, so they wait for her answer).
--   • XPO: 7384349 ($253.85, Jun) and 7429631 ($400.86, Aug) are already shared freight bills on the Freight page;
--     7311112 ($592.94) and 7319408 ($629.65) are from March, before Trevor (left alone, Oct 21). Their tasks close.
--   • Mechanix and Strike King: their tasks now say what the file is.

set local lock_timeout = '5s';

update public.email_attachments set accounting_skip = 'Edenred: XPO freight through WWD (Freight page; March bills are from before Trevor)'
 where id in ('bb45e495-9521-420f-bffe-f4899b804203', '29dc24c3-f10b-4268-a0dc-5654e091252f', '28030ffc-2efd-44b0-9d6c-2632034a9501', '6fb22ee4-82d2-42ff-ac49-73bcddf39f2b');

update public.tasks set done_at = now(), closed_how = 'request',
       done_note = 'The file is an XPO freight bill through WWD, not a vendor invoice. June and August XPO bills are on the Freight page; March ones are from before Trevor (Dana, Oct 21).'
 where id in ('859b2f04-7007-4eab-a37f-f498e9018c46', '430053d8-7d1a-4788-9a7c-98de4d93e673', '52504f87-ee4e-42aa-911a-2660a30ed174') and done_at is null;

update public.tasks set title = 'Edenred: Mechanix Wear invoice $59.04 (Apr 15, PO B671577), not one of our vendors',
       notes = 'Mechanix Wear is on Worldwide''s vendor list but not one of our vendors. PO B671577 is the PO on the Kinco Welch order of Feb 3. Ask Trevor what it was, then use File to a vendor on the email, or tell Claude.'
 where id = '314114b1-3411-4397-aa31-233d69335e6d' and done_at is null;

update public.tasks set title = 'Edenred: Strike King invoice $157.20 (Sep 8, PO SLS090226-SK), not one of our vendors',
       notes = 'Strike King is on Worldwide''s vendor list but not one of our vendors (4 Strike King lures in LS are under ZEBCO - WWD). Ask Jarrett what it was, then use File to a vendor on the email, or tell Claude. The other file in this email is an XPO freight bill (Freight page).'
 where id = 'e1faada2-5a73-43ac-b0b0-2d0dc6fd18cf' and done_at is null;
