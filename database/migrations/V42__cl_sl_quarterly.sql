-- Casual & Sick leave: 1 per 3-month quarter → 4 per year.
-- monthly_limit=1 is reused as the per-quarter allowance (enforced in code).
UPDATE leave_types SET max_days_per_year = 4, monthly_limit = 1 WHERE code IN ('CL', 'SL');

-- Bring existing allocations down to 4 for the current setup.
UPDATE leave_balances lb
JOIN leave_types lt ON lt.id = lb.leave_type_id
SET lb.allocated = 4
WHERE lt.code IN ('CL', 'SL');
