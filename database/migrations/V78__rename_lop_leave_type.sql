-- ============================================================
-- V78 — "lose of pay" reads as "Loss of Pay (LOP)".
--
-- The leave type was created by hand and the name went out on
-- payslips and approval tables spelt that way. Only the label
-- changes: the code, the allowance and every request already
-- pointing at it are untouched.
--
-- Matched case-insensitively on the name, and on the spelling that
-- was actually used, so nothing else is caught.
-- ============================================================

UPDATE leave_types
SET name = 'Loss of Pay (LOP)'
WHERE LOWER(TRIM(name)) IN ('lose of pay', 'loss of pay');
