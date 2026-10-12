-- 0095 — Primary/Promotions, second pass (Dana, Oct 12): a rep's own product pitches ("Black Friday special",
-- "toys in stock") are advertising too, so a rep's mail is no longer kept in Primary just for being from a rep;
-- the subject and Claude decide. Claude's earlier "Needs attention" and unsure answers are cleared so it reads
-- them again with the Primary/Promotions instructions (vendor promos sent from a person's own address go to
-- Promotions). The sync re-reads them 40 a minute.
create or replace function public.mail_view_for(p_direction text, p_labels text[], p_subject text, p_is_bulk boolean,
  p_addr_rule text, p_rule text, p_sender_kind text, p_conversation boolean, p_ai_view text default null)
returns text[] language sql immutable as $$
  select case
    when p_direction <> 'in' then array['attention', 'signals']
    -- conversations we wrote in, and order/invoice/shipping mail that is not a mass-mailed offer
    when p_conversation then array['attention', 'signals']
    when public.mail_is_transactional(p_subject) and not (coalesce(p_is_bulk, false) and public.mail_is_offerish(p_subject)) then array['attention', 'signals']
    when p_addr_rule is not null then array[p_addr_rule, 'rule']
    when p_rule = 'offers' then array['offers', 'rule']
    when 'CATEGORY_PROMOTIONS' = any (coalesce(p_labels, '{}')) then array['offers', 'gmail']
    -- mail from senders marked Other stays in Primary unless mass-mailed
    when p_rule = 'attention' and not coalesce(p_is_bulk, false) then array['attention', 'rule']
    when coalesce(p_is_bulk, false) then array['offers', 'signals']
    when public.mail_is_offerish(p_subject) then array['offers', 'signals']
    when p_ai_view is not null then array[p_ai_view, 'read']
    else array['attention', 'signals']
  end
$$;

update public.emails set ai_view = null, ai_read_at = null
 where direction = 'in' and ai_read_at is not null and ai_view is distinct from 'offers' and view_how is distinct from 'manual';
select public.mail_classify(o.id, null) from public.organizations o where exists (select 1 from public.emails e where e.organization_id = o.id);
