-- 0369 — The "Claude (testing)" login sees Accounting (Dana, Nov 13: "give the test login Accounting"), so Claude can look at
-- the policy and company pages after a change. It only looks. The Users page keeps the test login out of its list on purpose.
update public.profiles set sees_accounting = true
 where role = 'admin' and full_name = 'Claude (testing)' and email ilike 'claude-test@%';
