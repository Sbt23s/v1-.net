-- ============================================================
-- V74 — when an employee's probation ends.
--
-- employment_type already says PROBATION or PERMANENT, but not
-- until when, so "whose confirmation is coming up" could not be
-- answered. This holds the date it ends.
--
-- Left NULL for everybody. Where it is NULL the dashboard falls
-- back to date_of_joining + 6 months, so upcoming confirmations
-- work from day one without HR back-filling every record, and an
-- explicit date always wins once it is set.
-- ============================================================

ALTER TABLE users
    ADD COLUMN probation_end_date DATE NULL AFTER date_of_joining;
